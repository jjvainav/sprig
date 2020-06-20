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
    /** An event that gets raised whenever an edit has been dispatched; note, this will only raise edits dispatched against non-private channels. */
    readonly onEditDispatched: IEvent<IEditDispatchResult>;
    /** Creates a new channel used to publish edits against the queue. */
    createChannel(options?: IEditChannelOptions): IEditChannel;
}

/** A channel for publishing and consuming edits. */
export interface IEditChannel {
    /** True if the edit channel is private; meaning, edits dispatched against this channel will not be broadcast via the queue's edit dispatched event. */
    readonly isPrivate: boolean;
    /** Creates an object that acts as a consumer of dispatched edits that were published against the current channel. */
    createObserver(): IEditChannelObserver;
    /** Creates an object that publishes edits using the current channel to be dispatched. */
    createPublisher(): IEditChannelPublisher;
}

/** Provides a mechanism for extending an edit channel. */
export interface IEditChannelExtension {
    readonly observer?: (observer: IEditChannelObserver) => IEditChannelObserver;
    readonly publisher?: (publisher: IEditChannelPublisher) => IEditChannelPublisher;
}

/** Options for creating an edit channel. */
export interface IEditChannelOptions {
    /** True if the channel should be private and edits dispatched against the channel will not be broadcast via the queue's edit dispatched event; the default is false. */
    readonly isPrivate?: boolean;
    /** An extension for the edit channel. */
    readonly extend?: IEditChannelExtension;
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
    private readonly editDispatched = new EventEmitter<IEditDispatchResult>("queue-edit-dispatched");
    private readonly queue = new AsyncQueue<void>();

    constructor(private readonly dispatcher: IEditDispatcher) {
    }

    /** An event that gets raised whenever an edit has been dispatched; note, this will only raise edits dispatched against non-private channels. */
    get onEditDispatched(): IEvent<IEditDispatchResult> {
        return this.editDispatched.event;
    }

    createChannel(options?: IEditChannelOptions): IEditChannel {
        const queue = this;
        const extendObserver = options && options.extend && options.extend.observer || (observer => observer);
        const extendPublisher = options && options.extend && options.extend.publisher || (publisher => publisher);

        return new class EditChannel implements IEditChannel {
            private readonly editDispatched = new EventEmitter<IEditDispatchResult>("channel-edit-dispatched");

            readonly isPrivate = options !== undefined && options.isPrivate === true;

            createObserver(): IEditChannelObserver {
                return extendObserver(this.editDispatched.event);
            }

            createPublisher(): IEditChannelPublisher {
                return extendPublisher({
                    publish: edit => queue.push(this, edit).then(result => {
                        this.editDispatched.emit(result);

                        if (!this.isPrivate) {
                            queue.editDispatched.emit(result);
                        }

                        return result;
                    })
                });
            }
        };
    }

    private push(channel: IEditChannel, edit: IEditOperation): Promise<IEditDispatchResult> {
        return new Promise(resolve => this.queue.push(() => this.dispatcher(edit)
            .then(response => resolve({ success: true, channel, edit, response }))
            .catch(error => resolve({ success: false, channel, edit, error }))));
    }
}