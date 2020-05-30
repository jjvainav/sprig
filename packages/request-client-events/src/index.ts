import { EventEmitter, IEvent } from "@sprig/event-emitter";
import client, { IEventStreamOptions, IRequest, IRequestPromise, RequestError, RequestErrorCode } from "@sprig/request-client";
import EventSource from "eventsource";

/** Defines the event data for an invalid message received. */
export interface IInvalidDataEvent {
    readonly data: any;
    readonly message: string;
}

/** Defines a message event received from the event stream. */
export interface IMessageEvent<TData> {
    readonly data: TData;
}

/** Defines a function responsible for validating a data string received from the event source. */
export interface IMessageValidator<TData> {
    (data: string, resolve: (data: TData) => void, reject: (message: string) => void): void;
}

/** Defines an error when a connection to a server-sent event stream endpoint fails. */
export interface IEventStreamError {
    readonly type: "connection" | "http" | "network_unavailable" | "stream";
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

/** 
 * Defines the events for a server-sent event stream. Note: a stream will automatically
 * close close when all onMessage listeners are unregistered.
 */
export interface IRequestEventStream<TData = any> {
    /** An event that is raised when the event stream has been closed after a connection has been opened. */
    readonly onClose: IEvent;
    /** An event that is raised when a connection attempt with the event stream has failed. */
    readonly onError: IEvent<IEventStreamError>;
    /** An event that is raised when invalid data was recieved. */
    readonly onInvalidData: IEvent<IInvalidDataEvent>;
    /** An event that is raised when a message has been received. */
    readonly onMessage: IEvent<IMessageEvent<TData>>;
    /** An event that is raised after a connection has been opened. */
    readonly onOpen: IEvent;
    /** The current connection state for the event stream. */
    readonly readyState: ReadyState;
    /** Forces a stream to close. */
    close(): void;
}

export enum ReadyState { 
    connecting = 0, 
    open = 1, 
    closed = 2 
}

/** Default validator that validates and converts a JSON string to a JSON object. */
export const jsonValidator: IMessageValidator<any> = (data, resolve, reject) => {
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
    private readonly _close = new EventEmitter("sse-close");
    private readonly _error = new EventEmitter<IEventStreamError>("sse-error");
    private readonly _invalidData = new EventEmitter<IInvalidDataEvent>("sse-invalid-data");
    private readonly _open = new EventEmitter("sse-open");

    private readonly _message: EventEmitter<IMessageEvent<TData>>;
    private readonly validate: IMessageValidator<TData>;
    private source?: EventSource;

    private isConnecting = false;

    constructor(options: IEventStreamEmitterOptions<TData>) {
        const self = this;

        this.validate = options.validate || jsonValidator;
        this._message = new class extends EventEmitter<IMessageEvent<TData>> {
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
                if (!this.count) {
                    self.close();
                }
            }
        };
    }

    get onClose(): IEvent {
        return this._close.event;
    }

    get onError(): IEvent<IEventStreamError> {
        return this._error.event;
    }

    get onInvalidData(): IEvent<IInvalidDataEvent> {
        return this._invalidData.event;
    }

    get onMessage(): IEvent<IMessageEvent<TData>> {
        return this._message.event;
    }

    get onOpen(): IEvent {
        return this._open.event;
    }

    get readyState(): ReadyState {
        return this.source 
            ? this.source.readyState 
            : this.isConnecting
                ? ReadyState.connecting
                : ReadyState.closed;
    }

    close(): void {
        if (this.source) {
            this.source.close();
            this.source = undefined;
            this._close.emit();
        }
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
                        data => this._message.emit({ data }),
                        message => this._invalidData.emit({ data: e.data, message }));

                    // note: the onerror event is raised a connection attempt fails:
                    // https://developer.mozilla.org/en-US/docs/Web/API/EventSource/error_event
                    // when this happens the request client will reject with a RequestError

                    // also note: once connected the EventSource will remain 'connected' even 
                    // if the network goes down and the browser will constantly retry to reconnected

                    this.isConnecting = false;
                    this._open.emit();
                })
                .catch((err: Error) => {
                    this.isConnecting = false;
                    if (RequestError.isRequestError(err)) {
                        if (err.code === RequestErrorCode.httpError) {
                            this._error.emit({
                                type: "http",
                                status: err.response && err.response.status,
                                message: err.message
                            });
                        }
                        else if (err.code === RequestErrorCode.networkUnavailable) {
                            this._error.emit({ type: "network_unavailable", message: err.message });
                        }
                        else {
                            this._error.emit({ type: "connection", message: err.message });
                        }
                    }
                    else {
                        this._error.emit({
                            type: "stream",
                            message: err.message
                        });
                    }
                });
        }

        return Promise.resolve();
    }
}