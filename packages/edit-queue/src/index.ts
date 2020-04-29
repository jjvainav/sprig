import { AsyncQueue } from "@sprig/async-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IEditOperation } from "@sprig/edit-operation";

/** Defines an object responsible for dispatching published edits from the queue for execution and optionally returning a response. */
export interface IEditDispatcher<TResponse = void> {
    (edit: IEditOperation): Promise<TResponse>;
}

/** Defines the result of an edit that was dispatched. */
export interface IEditDispatchResult<TResponse = void> {
    readonly success: boolean;
    readonly channel: IEditChannel<TResponse>;
    readonly edit: IEditOperation;
    readonly error?: any;
    readonly response?: TResponse;
}

/** A multi-channel queue for dispatching and executing edit operations. */
export interface IEditQueue<TResponse = void> {
    createChannel(): IEditChannel<TResponse>;
}

/** A channel for publishing and consuming edits. */
export interface IEditChannel<TResponse = void> {
    /** Creates an object that acts as a consumer of dispatched edits that were published against the current channel. */
    createObserver(): IEditChannelObserver<TResponse>;
    /** Creates an object that publishes edits using the current channel to be dispatched. */
    createPublisher(): IEditChannelPublisher<TResponse>;
}

/** An object for observing dispatched edits on a channel. */
export interface IEditChannelObserver<TResponse = void> extends IEvent<IEditDispatchResult<TResponse>> {
}

/** An object responsible for publishing edits for dispatch. */
export interface IEditChannelPublisher<TResponse = void> {
    publish(edit: IEditOperation): Promise<IEditDispatchResult<TResponse>>;
}

/** Provides a mechanism for queueing and dispatching edits through one or more channels. */
export class EditQueue<TResponse = void> implements IEditQueue<TResponse> {
    private readonly queue = new AsyncQueue<void>();

    constructor(private readonly dispatcher: IEditDispatcher<TResponse>) {
    }

    createChannel(): IEditChannel<TResponse> {
        const queue = this;
        return new class EditChannel implements IEditChannel<TResponse> {
            private readonly dispatchedEdit = new EventEmitter<IEditDispatchResult<TResponse>>("channel-edit-dispatched");

            createObserver(): IEditChannelObserver<TResponse> {
                return this.dispatchedEdit.event;
            }

            createPublisher(): IEditChannelPublisher<TResponse> {
                return {
                    publish: edit => queue.push(this, edit).then(result => {
                        this.dispatchedEdit.emit(result);
                        return result;
                    })
                };
            }
        };
    }

    private push(channel: IEditChannel<TResponse>, edit: IEditOperation): Promise<IEditDispatchResult<TResponse>> {
        return new Promise(resolve => this.queue.push(() => this.dispatcher(edit)
            .then(response => resolve({ success: true, channel, edit, response }))
            .catch(error => resolve({ success: false, channel, edit, error }))));
    }
}