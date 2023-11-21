import { AsyncQueue } from "@sprig/async-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IEditOperation } from "@sprig/edit-operation";

/** 
 * Identifies how edits are ordered when dispatched from the queue. Channel ordering maintains order within each channel but not over the queue as a whole.
 * Queue ordering, on the otherhand, will dispatch edits in the order they are published regardless of channel.
 */
export type EditDispatchOrder = "channel" | "queue";

/** Defines an object responsible for dispatching published edits from the queue for execution and optionally returning a response. */
export interface IEditDispatcher<TResponse = void> {
    (edit: IEditOperation): Promise<TResponse>;
}

/** Defines the result of an edit that was dispatched. */
export interface IEditDispatchResult<TResponse = any> {
    readonly success: boolean;
    readonly edit: IEditOperation;
    readonly error?: any;
    readonly response?: TResponse;
}

/** A multi-channel queue for dispatching and executing edit operations. */
export interface IEditQueue<TResponse = void> {
    /** An event that gets raised whenever an edit has been dispatched; note, this will only raise edits dispatched against non-private channels. */
    readonly onEditDispatched: IEvent<IEditDispatchResult<TResponse>>;
    /** Creates a new channel used to publish edits against the queue. */
    createChannel<TChannelResponse = TResponse>(options?: IEditChannelOptions<TResponse, TChannelResponse>): IEditChannel<TChannelResponse>;
}

/** Defines options for creating an edit queue. */
export interface IEditQueueOptions<TResponse = void> {
    /** The dispatcher for the queue. */
    readonly dispatcher: IEditDispatcher<TResponse>;
    /** Defines how edits are dispitched inside the queue; the default is 'channel'. */
    readonly order?: EditDispatchOrder;
}

/** A channel for publishing and consuming edits. */
export interface IEditChannel<TResponse = void> {
    /** True if the channel is currently paused. */
    readonly isPaused: boolean;
    /** True if the edit channel is private; meaning, edits dispatched against this channel will not be broadcast via the queue's edit dispatched event. */
    readonly isPrivate: boolean;
    /** Creates an object that acts as a consumer of dispatched edits that were published against the current channel. */
    createObserver(): IEditChannelObserver<TResponse>;
    /** Creates an object that publishes edits using the current channel to be dispatched. */
    createPublisher(): IEditChannelPublisher<TResponse>;
    /** Pauses the underlying dispatch queue causing edits to queue up but not be dispatched until resumed. */
    pause(): void;
    /** Resumes a paused channel allowing pending edits to be dispatched. */
    resume(): void;
    /** Waits for the edit channel to become idle. */
    waitForIdle(): Promise<void>;
}

/** Provides a mechanism for extending an edit channel. */
export interface IEditChannelExtension<TExpectedResponse = void, TProcessedResponse = TExpectedResponse> {
    readonly observer?: (observer: IEditChannelObserver<TProcessedResponse>) => IEditChannelObserver<TProcessedResponse>;
    readonly publisher?: (publisher: IEditChannelPublisher<TExpectedResponse>) => IEditChannelPublisher<TProcessedResponse>;
}

/** Options for creating an edit channel. */
export interface IEditChannelOptions<TExpectedResponse = void, TProcessedResponse = TExpectedResponse> {
    /** True if the channel should be private and edits dispatched against the channel will not be broadcast via the queue's edit dispatched event; the default is false. */
    readonly isPrivate?: boolean;
    /** An extension for the edit channel. */
    readonly extend?: IEditChannelExtension<TExpectedResponse, TProcessedResponse>;
}

/** An object for observing dispatched edits on a channel. */
export interface IEditChannelObserver<TResponse = void> extends IEvent<IEditDispatchResult<TResponse>> {
}

/** An object responsible for publishing edits for dispatch. */
export interface IEditChannelPublisher<TResponse = void> {
    /** Publishes an edit onto the queue immediately and returns a promise to wait for the final dispatch result of the request. */
    publish(edit: IEditOperation): Promise<IEditDispatchResult<TResponse>>;
}

/** Provides a mechanism for queueing and dispatching edits through one or more channels. */
export class EditQueue<TResponse = void> implements IEditQueue<TResponse> {
    private readonly editDispatched = new EventEmitter<IEditDispatchResult<TResponse>>();

    private readonly dispatcher: IEditDispatcher<TResponse>;
    private readonly getDispatchQueueForChannel: () => AsyncQueue<any>;

    constructor(dispatcher: IEditDispatcher<TResponse>);
    constructor(options: IEditQueueOptions<TResponse>);
    constructor(dispatcherOrOptions: IEditDispatcher<TResponse> | IEditQueueOptions<TResponse>) {
        const options = typeof dispatcherOrOptions === "object" ? dispatcherOrOptions : { dispatcher: dispatcherOrOptions };
        let queue: AsyncQueue<any> | undefined;

        this.dispatcher = options.dispatcher;
        this.getDispatchQueueForChannel = options.order === "queue" 
            ? () => queue = queue || new AsyncQueue<any>() 
            : () => new AsyncQueue<any>();
    }

    /** An event that gets raised whenever an edit has been dispatched; note, this will only raise edits dispatched against non-private channels. */
    get onEditDispatched(): IEvent<IEditDispatchResult> {
        return this.editDispatched.event;
    }

    createChannel<TChannelResponse = TResponse>(options?: IEditChannelOptions<TResponse, TChannelResponse>): IEditChannel<TChannelResponse> {
        // TODO: would it be possible to add type safety that requires an extended publisher if TChannelResponse and TResponse are not equal?

        const extendObserver = options && options.extend && options.extend.observer || (observer => observer);
        const extendPublisher = options && options.extend && options.extend.publisher;

        const dispatchQueue = this.getDispatchQueueForChannel();
        const channelEditDispatched = new EventEmitter<IEditDispatchResult<TChannelResponse>>();
        const push = (channel: IEditChannel<any>, edit: IEditOperation): Promise<IEditDispatchResult<TResponse>> => {
            return new Promise(resolve => dispatchQueue.push(() => this.dispatcher(edit)
                .then(response => resolve({ success: true, edit, response }))
                .catch(error => resolve({ success: false, edit, error }))));
        };

        const basePublisher: IEditChannelPublisher<any> = {
            publish: edit => push(channel, edit).then(result => {
                if (!channel.isPrivate) {
                    this.editDispatched.emit(result);
                }

                return result;
            })
        };

        const channel: IEditChannel<TChannelResponse> = {
            get isPaused() {
                return dispatchQueue.isPaused;
            },
            isPrivate: options !== undefined && options.isPrivate === true,
            createObserver: () => extendObserver(channelEditDispatched.event),
            createPublisher: () => {
                // create/grab the publisher to return and hook it so we can emit the dispatch event for the channel
                const publisher = extendPublisher && extendPublisher(basePublisher) || basePublisher;
                return { 
                    publish: edit => publisher.publish(edit).then(result => {
                        channelEditDispatched.emit(result);
                        return result;
                    }) 
                };
            },
            pause: () => dispatchQueue.pause(),
            resume: () => dispatchQueue.resume(),
            waitForIdle: () => dispatchQueue.waitForIdle()
        };

        return channel;
    }
}