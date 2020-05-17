import { EventEmitter, IEvent } from "@sprig/event-emitter";
import client, { IEventStreamOptions, IRequest, IRequestPromise, RequestError } from "@sprig/request-client";
import EventSource from "eventsource";

/** Defines a message event received from the event stream. */
export interface IMessageEvent {
    readonly data: any;
}

/** Defines an error for a server-sent event stream. */
export interface IEventStreamError {
    readonly type: "http" | "invalid_data" | "stream";
    readonly status?: number;
    readonly message: string;
}

export interface IEventStreamHttpError extends IEventStreamError {
    readonly type: "http";
    readonly status: number;
}

/** Options for the server-sent event emitters. */
export interface IEventStreamEmitterOptions extends IEventStreamOptions {
    /** Allows preparing a request by adding request interceptors. */
    readonly beforeRequest?: (request: IRequest) => IRequest;
    /** Allows handling the request promise for adding response interceptors. */
    readonly afterRequest?: (promise: IRequestPromise) => IRequestPromise;
}

/** Defines the events for a server-sent event stream. */
export interface IRequestEventStream {
    readonly isConnected: boolean;
    readonly onClose: IEvent;
    readonly onError: IEvent<IEventStreamError>;
    readonly onMessage: IEvent<IMessageEvent>;
    readonly onOpen: IEvent;
}

function isEventSource(data: any): data is EventSource {
    // the onmessage should always be defined and defaults to null if no handlers are registered with the EventSource
    return (<EventSource>data).onmessage !== undefined;
}

/** 
 * A wrapper class for making a client event stream request (i.e. connecting to a server-sent event endpoint). 
 * Note: the connection is lazy and won't be established until a listener has been registered with the onMessage event
 * and will automatically be closed once all listeners have been unregistered.
 */
export class RequestEventStream implements IRequestEventStream {
    private readonly close = new EventEmitter("sse-close");
    private readonly error = new EventEmitter<IEventStreamError>("sse-error");
    private readonly open = new EventEmitter("sse-open");

    private readonly message: EventEmitter<IMessageEvent>;
    private source?: EventSource;

    private isConnecting = false;

    constructor(options: IEventStreamEmitterOptions) {
        const self = this;
        this.message = new class extends EventEmitter<IMessageEvent> {
            constructor() {
                super("sse-message");
            }

            protected callbackRegistered(): void {
                if (!self.source) {
                    // after connecting verify that the listener is still registered; auto-close if not
                    self.connect(options).then(() => this.autoClose());
                }
            }

            protected callbackUnregistered(): void {
                this.autoClose();
            }

            private autoClose(): void {
                // automatically close if there are no listeners registered
                if (!this.count && self.source) {
                    self.source.close();
                    self.source = undefined;
                    self.close.emit();
                }
            }
        };
    }

    get isConnected(): boolean {
        return this.source !== undefined;
    }

    get onClose(): IEvent {
        return this.close.event;
    }

    get onError(): IEvent<IEventStreamError> {
        return this.error.event;
    }

    get onMessage(): IEvent<IMessageEvent> {
        return this.message.event;
    }

    get onOpen(): IEvent {
        return this.open.event;
    }

    private connect(options: IEventStreamEmitterOptions): Promise<void> {
        if (!this.source && !this.isConnecting) {
            this.isConnecting = true;

            let request = client.stream(options);
            request = options.beforeRequest ? options.beforeRequest(request) : request;

            let promise = request.invoke();
            promise = options.afterRequest ? options.afterRequest(promise) : promise;

            return promise
                .then(response => {
                    if (!isEventSource(response.data)) {
                        throw new Error("Invalid response data.");
                    }

                    this.source = response.data;
                    this.source.onmessage = e => this.message.emit({ data: this.parseMessageData(e.data) });
                    // TODO: add a handler to the EventSource error to capture errors after connecting/opening?

                    this.isConnecting = false;
                    this.open.emit();
                })
                .catch((err: RequestError) => {
                    this.isConnecting = false;

                    // TODO: need to test and add better error handling
                    // -- handle when RequestError code is something other than http
                    this.error.emit({
                        type: "http",
                        status: err.response && err.response.status,
                        message: err.message
                    });
                });
        }

        return Promise.resolve();
    }

    private parseMessageData(data: any): any {
        if (typeof data === "string") {
            try {
                return JSON.parse(data);
            }
            catch {
            }
        }

        return data;
    }
}