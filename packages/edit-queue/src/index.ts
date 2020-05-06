import { AsyncQueue } from "@sprig/async-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IEditOperation } from "@sprig/edit-operation";

/** Defines an object responsible for dispatching published edits from the queue for execution and optionally returning a response. */
export interface IEditDispatcher {
    (edit: IEditOperation): Promise<any>;
}

/** Defines the result of an edit that was dispatched. */
export interface IEditDispatchResult {
    readonly success: boolean;
    readonly channel: IEditChannel;
    readonly edit: IEditOperation;
    readonly error?: any;
    readonly response?: any;
}

/** A multi-channel queue for dispatching and executing edit operations. */
export interface IEditQueue {
    createChannel(): IEditChannel;
}

/** A channel for publishing and consuming edits. */
export interface IEditChannel {
    /** Creates an object that acts as a consumer of dispatched edits that were published against the current channel. */
    createObserver(): IEditChannelObserver;
    /** Creates an object that publishes edits using the current channel to be dispatched. */
    createPublisher(): IEditChannelPublisher;
}

/** An object for observing dispatched edits on a channel. */
export interface IEditChannelObserver extends IEvent<IEditDispatchResult> {
}

/** An object responsible for publishing edits for dispatch. */
export interface IEditChannelPublisher {
    /** Publishes an edit to the queue. */
    publish(edit: IEditOperation): Promise<IEditDispatchResult>;
}

/** Provides a mechanism for queueing and dispatching edits through one or more channels. */
export class EditQueue implements IEditQueue {
    private readonly queue = new AsyncQueue<void>();

    constructor(private readonly dispatcher: IEditDispatcher) {
    }

    createChannel(): IEditChannel {
        const queue = this;
        return new class EditChannel implements IEditChannel {
            private readonly dispatchedEdit = new EventEmitter<IEditDispatchResult>("channel-edit-dispatched");

            createObserver(): IEditChannelObserver {
                return this.dispatchedEdit.event;
            }

            createPublisher(): IEditChannelPublisher {
                return {
                    publish: edit => queue.push(this, edit).then(result => {
                        this.dispatchedEdit.emit(result);
                        return result;
                    })
                };
            }
        };
    }

    private push(channel: IEditChannel, edit: IEditOperation): Promise<IEditDispatchResult> {
        return new Promise(resolve => this.queue.push(() => this.dispatcher(edit)
            .then(response => resolve({ success: true, channel, edit, response }))
            .catch(error => resolve({ success: false, channel, edit, error }))));
    }
}