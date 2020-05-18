import { EventEmitter, IEvent } from "@sprig/event-emitter";
import client, { IEventStreamOptions, IRequest, IRequestPromise, RequestError } from "@sprig/request-client";
import EventSource from "eventsource";

/** Defines a message event received from the event stream. */
export interface IMessageEvent<TData> {
    readonly data: TData;
}

/** Defines a function responsible for validating a data string received from the event source. */
export interface IMessageValidator<TData> {
    (data: string, resolve: (data: TData) => void, reject: (message: string) => void): void;
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
export interface IEventStreamEmitterOptions<TData> extends IEventStreamOptions {
    /** Allows preparing a request by adding request interceptors. */
    readonly beforeRequest?: (request: IRequest) => IRequest;
    /** Allows handling the request promise for adding response interceptors. */
    readonly afterRequest?: (promise: IRequestPromise) => IRequestPromise;
    /** An optional validator for the message data; the default validator verifies and converts the data to a JSON object. */
    readonly validate?: IMessageValidator<TData>;
}

/** Defines the events for a server-sent event stream. */
export interface IRequestEventStream<TData = any> {
    readonly onClose: IEvent;
    readonly onError: IEvent<IEventStreamError>;
    readonly onMessage: IEvent<IMessageEvent<TData>>;
    readonly onOpen: IEvent;
    readonly readyState: ReadyState;
}

export enum ReadyState { 
    connecting = 0, 
    open = 1, 
    closed = 2 
}

const jsonValidator: IMessageValidator<any> = (data, resolve, reject) => {
    if (typeof data === "object") {
        return resolve(data);
    }
    
    try {
        return resolve(JSON.parse(data));
    }
    catch {
    }

    reject("Invalid json.");
};

function isEventSource(data: any): data is EventSource {
    return (<EventSource>data).readyState !== undefined;
}

/** 
 * A wrapper class for making a client event stream request (i.e. connecting to a server-sent event endpoint). 
 * Note: the connection is lazy and won't be established until a listener has been registered with the onMessage event
 * and will automatically be closed once all listeners have been unregistered.
 */
export class RequestEventStream<TData = any> implements IRequestEventStream<TData> {
    private readonly close = new EventEmitter("sse-close");
    private readonly error = new EventEmitter<IEventStreamError>("sse-error");
    private readonly open = new EventEmitter("sse-open");

    private readonly message: EventEmitter<IMessageEvent<TData>>;
    private readonly validate: IMessageValidator<TData>;
    private source?: EventSource;

    private isConnecting = false;

    constructor(options: IEventStreamEmitterOptions<TData>) {
        const self = this;

        this.validate = options.validate || jsonValidator;
        this.message = new class extends EventEmitter<IMessageEvent<TData>> {
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

    get onClose(): IEvent {
        return this.close.event;
    }

    get onError(): IEvent<IEventStreamError> {
        return this.error.event;
    }

    get onMessage(): IEvent<IMessageEvent<TData>> {
        return this.message.event;
    }

    get onOpen(): IEvent {
        return this.open.event;
    }

    get readyState(): ReadyState {
        return this.source 
            ? this.source.readyState 
            : this.isConnecting
                ? ReadyState.connecting
                : ReadyState.closed;
    }

    private connect(options: IEventStreamEmitterOptions<TData>): Promise<void> {
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
                    this.source.onmessage = e => this.validate(
                        e.data,
                        data => this.message.emit({ data }),
                        message => this.error.emit({ type: "invalid_data", message }));

                    // TODO: add a handler to the EventSource error to capture errors after connecting/opening?

                    this.isConnecting = false;
                    this.open.emit();
                })
                .catch((err: Error) => {
                    this.isConnecting = false;
                    if (RequestError.isRequestError(err)) {
                        // TODO: need to test and add better error handling
                        // -- handle when RequestError code is something other than http
                        this.error.emit({
                            type: "http",
                            status: err.response && err.response.status,
                            message: err.message
                        });
                    }
                    else {
                        this.error.emit({
                            type: "stream",
                            message: err.message
                        });
                    }
                });
        }

        return Promise.resolve();
    }
}