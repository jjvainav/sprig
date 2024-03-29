import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IEventStreamOptions, IRequest, IRequestClient, IRequestPromise, IResponse, RequestError, RequestErrorCode } from "@sprig/request-client";

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
    readonly response?: IResponse;
    readonly message: string;
}

export interface IEventStreamHttpError extends IEventStreamError {
    readonly type: "http";
    readonly response: IResponse;
}

/** Options for the server-sent event emitters. */
export interface IEventStreamEmitterOptions<TData> extends IEventStreamOptions {
    /** A request client used to connect to an event stream. */
    readonly client: IRequestClient;
    /** If true, the event stream will automatically be closed when all message handlers have been unregistered; the default is true. */
    readonly autoClose?: boolean;
    /** If true, the event stream will automatically connected when a message handler has been registered; the default is true. */
    readonly autoConnect?: boolean;
    /** Allows preparing a request by adding request interceptors. */
    readonly beforeRequest?: (request: IRequest) => IRequest;
    /** Allows handling the request promise for adding response interceptors. */
    readonly afterRequest?: (promise: IRequestPromise) => IRequestPromise;
    /** An optional validator for the message data; the default validator verifies and converts the data to a JSON object. */
    readonly validate?: IMessageValidator<TData>;
}

/** 
 * Defines the events for a server-sent event stream. Note: a stream will automatically
 * close when all onMessage listeners are unregistered.
 */
export interface IRequestEventStream<TData = any> {
    /** An event that is raised when the event stream has been closed after a connection has been opened. */
    readonly onClose: IEvent;
    /** An event that is raised when a connection attempt with the event stream has failed. */
    readonly onError: IEvent<IEventStreamError>;
    /** An event that is raised when invalid data was recieved. */
    readonly onInvalidData: IEvent<IInvalidDataEvent>;
    /** 
     * An event that is raised when a message has been received. Note: a stream will automatically
     * connect (unless overriden) and close when listeners are registered and unregistered.
     */
    readonly onMessage: IEvent<IMessageEvent<TData>>;
    /** An event that is raised after a connection has been opened. */
    readonly onOpen: IEvent;
    /** The current connection state for the event stream. */
    readonly readyState: ReadyState;
    /** Forces a stream to close. */
    close(): void;
    /** Manually connects the event stream. */
    connect(): Promise<IConnectionResult>;
}

/** Defines the result of a connection attempt. */
export interface IConnectionResult {
    /** True if successful; otherwise false. */
    readonly success: boolean;
    /** A stream error containing information about a failed connection attempt. */
    readonly error?: IEventStreamError;
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

    private connectionPromise?: Promise<IConnectionResult>;

    constructor(private readonly options: IEventStreamEmitterOptions<TData>) {
        const self = this;

        this.validate = options.validate || jsonValidator;
        this._message = new class extends EventEmitter<IMessageEvent<TData>> {
            protected callbackRegistered(): void {
                if (self.shouldAutoConnect() && !self.source) {
                    // after connecting verify that the listener is still registered; auto-close if not
                    self.connect().then(() => this.autoClose());
                }
            }

            protected callbackUnregistered(): void {
                this.autoClose();
            }

            private autoClose(): void {
                // automatically close if there are no listeners registered
                if (self.shouldAutoClose() && !this.count) {
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
            : this.connectionPromise
                ? ReadyState.connecting
                : ReadyState.closed;
    }

    close(): void {
        if (this.source) {
            this.source.close();
            this.source = undefined;
            this.connectionPromise = undefined;
            this._close.emit();
        }
    }

    connect(): Promise<IConnectionResult> {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        let request = this.options.client.stream(this.options);
        request = this.options.beforeRequest ? this.options.beforeRequest(request) : request;

        let promise = request.invoke();
        promise = this.options.afterRequest ? this.options.afterRequest(promise) : promise;

        this.connectionPromise = promise
            .then(response => {
                if (!isEventSource(response.data)) {
                    throw new Error("Invalid response data.");
                }

                this.source = response.data;
                this.source.onmessage = e => this.validate(
                    e.data,
                    data => this._message.emit({ data }),
                    message => this._invalidData.emit({ data: e.data, message }));

                // note: the onerror event is raised when a connection attempt fails:
                // https://developer.mozilla.org/en-US/docs/Web/API/EventSource/error_event
                // when this happens the request client will reject with a RequestError

                // also note: once connected the EventSource will remain 'connected' even 
                // if the network goes down and the browser will constantly retry to reconnected

                this._open.emit();
                return { success: true };
            })
            .catch((err: Error) => {
                let error: IEventStreamError;
                if (RequestError.isRequestError(err)) {
                    if (err.code === RequestErrorCode.httpError) {
                        error = {
                            type: "http",
                            response: err.response,
                            message: err.message
                        };
                    }
                    else if (err.code === RequestErrorCode.networkUnavailable) {
                        error = { type: "network_unavailable", message: err.message };
                    }
                    else {
                        error = { type: "connection", message: err.message };
                    }
                }
                else {
                    error = {
                        type: "stream",
                        message: err.message
                    };
                }

                // need to reset the connection promise manually if there is an error trying to connect
                // do so before raising the error event incase listens want to retry the connection
                this.connectionPromise = undefined;
                this._error.emit(error);
                return { success: false };
            });

        return this.connectionPromise;
    }

    private shouldAutoClose(): boolean {
        return this.options.autoClose !== undefined ? this.options.autoClose : true;
    }

    private shouldAutoConnect(): boolean {
        return this.options.autoConnect !== undefined ? this.options.autoConnect : true;
    }
}