import axios, { AxiosError } from "axios";

/** Represents an error while attempting to make a request. */
export enum RequestErrorCode {
    /** Indicates that an invalid response was received. */
    invalidResponse = "invalid-response",
    /** Indicates that the response for a request returned an http error status. */
    httpError = "http-error",
	/** Indicates that a request failed due to an error in the request client. */
    clientError = "client-error",
    /** Indicates that the request could not be made because the network is currently unavailable. */
    networkUnavailable = "network-unavailable",
    /** Indicates that the request could not be made because the target service is currently unavailable. */
	serviceUnavailable = "service-unavailable",    
	/** A request has timed out while waiting for a response. */
	timeout = "timeout"
}

const enum Headers {
    requestId = "X-Request-ID"
}

const defaultTimeout = 5000; // 5 seconds

export type RequestInterceptorFunction = (context?: IRequestInterceptorContext) => void;
export type ResponseInterceptorFunction = (context?: IResponseInterceptorContext) => void;
export type RequestErrorArgs = {
    readonly code: RequestErrorCode;
    readonly message: string;
    readonly request: IRequest;
    readonly response?: IResponse;
    readonly data?: any;
};

export interface IRequestClient {
    readonly request: IRequestBuilder;
    readonly stream: IEventStreamBuilder;
}

export interface IRequest {
    readonly id: string;
    readonly options: IRequestOptions;

    invoke(): IRequestPromise;
    use(interceptor: IRequestInterceptor): IRequest;
    
    /** A helper function that will append a header to the request. */
    withHeader(name: string, value: string): IRequest;
    /** 
     * A helper function to add an interceptor that will be called immediately after invoke. 
     * Note: response interceptors used against the request promise will be invoked after interceptors added using this function.
     */
    withResponseInterceptor(interceptor: IResponseInterceptor): IRequest;
}

/** Defines a callback that accepts request options and builds a request. */
export interface IRequestBuilder {
    (options: IRequestOptions): IRequest;
}

/** Defines options for an HTTP request. */
export interface IRequestOptions {
    /** The HTTP verb for the request; if not provided, the default is GET. */
    readonly method?: "GET" | "PATCH" | "POST" | "PUT" | "DELETE";
    /** The url for the request. */
    readonly url: string;
    /** Data to send as the request body. */
    readonly data?: any;
    /** The timeout (in milliseconds) when waiting for a response from the server; the default is 0 (no timeout).*/
    readonly timeout?: number;
    /** A set of headers for the request. */
    readonly headers?: { readonly [key: string]: string };
    /** 
     * Defines the expected status codes for a request. If a status is not one of the expected
     * status codes the request promise will be rejected with an http request error. This 
     * can either be an array of expected status codes or a function that returns true for
     * a given status code if it is expected. The default behavior is to resolve 2xx status 
     * codes and reject all others.
     */
    readonly expectedStatus?: number[] | ((status: number) => boolean);
}

/** Defines a callback that accepts event stream options and builds a request. */
export interface IEventStreamBuilder {
    (options: IEventStreamOptions): IRequest;
}

/** Defines options for connection to an event-stream. Note: the data and timeout options/properties are ignored. */
export interface IEventStreamOptions extends IRequestOptions {
    /** The HTTP verb for an event stream must be GET. */
    readonly method?: "GET";
    /** Defines the expected status codes when connecting to the event stream endpoint; this only allows 200. */
    readonly expectedStatus?: [200];
}

export interface IRequestInterceptorContext {
    readonly request: IRequest;
    readonly next: RequestInterceptorFunction;
    readonly resolve: (response: { readonly status: number; readonly data: any; }) => void;
    readonly reject: (error: RequestError) => void;
}

export interface IRequestInterceptor {
    (context: IRequestInterceptorContext): void;
}

export interface IResponse {
    readonly request: IRequest;
    readonly status: number;
    readonly data: any;
}

export interface IResponseInterceptorContext {
    readonly request: IRequest;
    readonly next: ResponseInterceptorFunction;
    readonly end: ResponseInterceptorFunction;
    readonly response?: IResponse;
    readonly error?: RequestError;
}

interface IRequestInvoker {
    (request: IRequest): Promise<IInvokeResult>;
}

interface IInvokeResult {
    readonly request: IRequest;
    readonly response: IResponse;
}

/** 
 * Intercepts request responses. Note: an interceptor must invoke next in order to continue the chain 
 * and resolve the request. If the function omits the context argument next will be invoked automatically by 
 * the service. Optionally, end can be invoked to end the chain.
 */
export interface IResponseInterceptor {
    (context: IResponseInterceptorContext): void;
}

export interface IRequestPromise extends Promise<IResponse> {
    /** 
     * Invokes a response interceptor against a response. Response interceptors are a way to handle a response
     * with added support not provided with the native Promise. For example, an interceptor can break a 
     * 'thenUse' call chain whereas the only way to break a 'then' call chain for a Promise is to throw.
     * Once the interceptor call chain ends the native 'then' and 'catch' functions will get invoked.
     */
    thenUse(interceptor: IResponseInterceptor): IRequestPromise;
}

/** Builds a new request client using the specified event source factory method for creating EventSource instances. */
export function buildClient(createEventSource: (options: IRequestOptions) => EventSource): IRequestClient {
    return {
        /** Invokes an HTTP request. */
        request(options: IRequestOptions): IRequest {
            // TODO: need to check if a network connection is available
            return injectRequestId(new RequestInstance(options, axiosInvoker));
        },
        /** 
         * Connects to an HTTP endpoint that opens an event-stream; if successful, the response data will contain a reference to the EventSource. 
         * Note: response interceptors will only be invoked on the initial connection and not agains received event messages.
         */
        stream(options: IEventStreamOptions): IRequest {
            return new RequestInstance(options, createEventSourceInvoker(createEventSource));
        }
    };
}

/** Determines if the specified response status code is expected by the provided request. */
export function isExpectedStatus(request: IRequest, status: number): boolean {
    if (!request.options.expectedStatus) {
        return validateExpectedStatus(status);
    }

    return Array.isArray(request.options.expectedStatus)
        ? (<number[]>request.options.expectedStatus).indexOf(status) > -1
        : request.options.expectedStatus(status);
}

function createErrorForResponse(request: IRequest, response: { status: number, data: any }, message?: string): RequestError {
    const errorResponse = {
        request: request,
        status: response.status,
        data: response.data
    };

    if (response.status === 408 || response.status === 504) {
        return new RequestError({
            code: RequestErrorCode.timeout,
            message: message || "The request has timed out.",
            request: request,
            response: errorResponse
        });
    }
    
    if (response.status === 451 || response.status === 503) {
        return new RequestError({
            code: RequestErrorCode.serviceUnavailable,
            message: message || "Service unavailable.",
            request: request,
            response: errorResponse
        });
    }
    
    return new RequestError({
        code: RequestErrorCode.httpError,
        message: message || `Request failed with status ${response.status}.`,
        request: request,
        response: errorResponse
    });     
}

function createEventSourceInvoker(createEventSource: (options: IRequestOptions) => EventSource): IRequestInvoker {
    return request => new Promise((resolve, reject) => {
        const source = createEventSource(request.options);
        const onopen = () => {
            source.removeEventListener("open", onopen);
            source.removeEventListener("error", onerror);
    
            resolve({
                request,
                response: {
                    request: request,
                    status: 200,
                    data: source
                }
            });
        };
        const onerror = (event: Event) => {
            source.removeEventListener("open", onopen);
            source.removeEventListener("error", onerror);
    
            if (source.readyState !== source.CLOSED) {
                // should not get here but just to be safe
                source.close();
            }
    
            // see notes above about native EventSource not including status code - return a generic 400 if a status code is not available
            const status: number = (<any>event).status;
            if (status) {
                // the EventSource polyfill will include the HTTP status if the request returned a non-200 status code and 
                // is useful if the connection failed for some reason other than a network issue (e.g. unauthorized, invalid endpoint, etc.)
                reject(createErrorForResponse(request, { status, data: {} }, (<any>event).message));    
            }
    
            // the native EventSource does not provide a status code or any other useful info for a failed connection
            if (typeof window !== "undefined" && !window.navigator.onLine) {
                reject({
                    code: RequestErrorCode.networkUnavailable,
                    message: "Network unavailable.",
                    request: request
                });
            }
    
            // if we get here assume there was an issue with the client but we aren't able to determine exactly what
            reject({
                code: RequestErrorCode.clientError,
                message: "Failed to connect to server.",
                request: request
            });
        };
    
        source.addEventListener("error", onerror);
        source.addEventListener("open", onopen);
    });
}

const alphabet = "abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789";
function generateId(): string {
    let id = "";

    for (let i = 0; i < 12; i++) {
        id += alphabet[Math.random() * 64 | 0];
    }

    return id;
}

function injectRequestId(request: IRequest): IRequest {
    if (!request.options.headers || !request.options.headers[Headers.requestId]) {
        return request.withHeader(Headers.requestId, generateId());
    }

    return request;
}

function isAxiosError(error: Error): error is AxiosError {
    // TODO: when axios version 0.19 is released the AxiosError object has an isAxiosError flag that should be used to check if the Error is an AxiosError
    return (<any>error).request !== undefined;
}

function validateExpectedStatus(status: number): boolean {
    // default logic for validating a status - return true for all 2xx codes
    return status >= 200 && status < 300;
}

const axiosInvoker: IRequestInvoker = request => new Promise((resolve, reject) => {
    axios.request({
        url: request.options.url,
        method: request.options.method || "GET",
        headers: request.options.headers,
        data: request.options.data,
        timeout: request.options.timeout || defaultTimeout,
        validateStatus: status => isExpectedStatus(request, status)
    })
    .then(response => resolve({
        request,
        response: {
            request: request,
            status: response.status,
            data: response.data
        }
    }))
    .catch(error => {
        // note: the axios error will get thrown for responses that fail validateStatus (i.e. status codes not specified as an expected status)
        if (isAxiosError(error)) {
            if (error.response) {
                reject(createErrorForResponse(request, error.response, error.message));
            }
            else if (error.code === "ECONNABORTED") {
                reject(new RequestError({
                    code: RequestErrorCode.timeout, 
                    message: error.message,
                    request: request
                }));                        
            }
            else {
                reject(new RequestError({
                    code: RequestErrorCode.clientError, 
                    message: error.message,
                    request: request
                }));
            }
        }
        else {
            // should never get here...
            reject(new Error(`Unexpected error from Axios (${error.message})`));
        }
    });
});

export class RequestError extends Error {
    private readonly __isRequestError = true;

    readonly code: RequestErrorCode;
    readonly request: IRequest;
    readonly response?: IResponse;
    readonly data?: any;

    constructor(args: RequestErrorArgs) {
        super(args.message);
        Object.setPrototypeOf(this, RequestError.prototype);
        this.name = "RequestError";
        this.code = args.code;
        this.request = args.request;
        this.response = args.response;
        this.data = args.data;
    }

    static isRequestError(err: Error): err is RequestError {
        return (<RequestError>err).__isRequestError;
    }
}

class RequestInstance implements IRequest {
    constructor(
        readonly options: IRequestOptions,
        private readonly invoker: IRequestInvoker,
        private readonly requestInterceptors: IRequestInterceptor[] = [],
        private readonly responseInterceptors: IResponseInterceptor[] = []) {
    }

    get id(): string {
        const id = this.options.headers && this.options.headers[Headers.requestId];
        if (!id) {
            throw new Error("Request does not have an id.");
        }

        return id;
    }

    invoke(): IRequestPromise {
        return RequestInstance.invokeRequest(this, this.invoker, this.requestInterceptors, this.responseInterceptors);
    }

    use(interceptor: IRequestInterceptor): IRequest {
        return new RequestInstance(this.options, this.invoker, [...this.requestInterceptors, interceptor], this.responseInterceptors);
    }

    withHeader(name: string, value: string): IRequest {
        const options = {
            ...this.options,
            headers: !this.options.headers ? { [name]: value } : {
                ...this.options.headers,
                [name]: value
            }
        };

        return new RequestInstance(options, this.invoker, this.requestInterceptors, this.responseInterceptors);      
    }

    withResponseInterceptor(interceptor: IResponseInterceptor): IRequest {
        return new RequestInstance(this.options, this.invoker, this.requestInterceptors, [...this.responseInterceptors, interceptor]);
    }

    private static invokeRequest(request: IRequest, invoker: IRequestInvoker, requestInterceptors: IRequestInterceptor[], responseInterceptors: IResponseInterceptor[]): IRequestPromise {
        const promise = requestInterceptors.length > 0
            ? RequestInstance.invokeRequestInterceptors(request, invoker, requestInterceptors)
            : invoker(request);

        const requestPromise = promise
            .then(result => {
                // verify that any modifications to the request are done properly
                if (!RequestInstance.verifyRequest(result.request)) {
                    throw new Error("Invalid request object.");
                }

                return RequestInstance.invokeResponseInterceptors({
                    request: new RequestInstance(request.options, invoker, requestInterceptors, responseInterceptors),
                    interceptors: responseInterceptors,
                    response: result.response
                });
            })
            .catch(error => {
                if (RequestError.isRequestError(error)) {
                    return RequestInstance.invokeResponseInterceptors({
                        request: new RequestInstance(request.options, invoker, requestInterceptors, responseInterceptors),
                        interceptors: responseInterceptors,
                        error
                    });
                }

                throw error;
            });

        return Object.assign(requestPromise, { 
            thenUse: (interceptor: IResponseInterceptor) => {
                responseInterceptors = [...responseInterceptors, interceptor];
                return <IRequestPromise>requestPromise;
            }
        });     
    }

    private static invokeResponseInterceptors(args: { request: IRequest; interceptors: IResponseInterceptor[]; response?: IResponse; error?: RequestError }): Promise<IResponse> {
        return new Promise<IResponse>((resolve, reject) => {
            let i = 0;
            let current: IResponseInterceptorContext;
            const end: ResponseInterceptorFunction = context => {
                current = context || current;
                if (current.response && current.error) {
                    throw new Error("response and error should not both be defined; if an error occurred pass the response to the RequestError.");
                }

                i = args.interceptors.length;
                if (current.response) {
                    resolve(current.response);
                }
                else if (current.error) {
                    reject(current.error);
                }
                else {
                    reject(new RequestError({
                        code: RequestErrorCode.clientError,
                        message: "Response context does not define a response or error object.",
                        request: args.request
                    }));
                }
            };
            const next: ResponseInterceptorFunction = context => {
                current = context || current;
                if (args.interceptors.length > i) {
                    const fn = args.interceptors[i++];
                    fn(current);

                    if (!fn.length) {
                        // manually invoke next if the interceptor function does not accept any arguments
                        next(current);
                    }
                }
                else {
                    end(current);
                }
            };
    
            next({
                request: args.request,
                next,
                end,
                response: args.response,
                error: args.error
            }); 
        });
    }

    private static invokeRequestInterceptors(request: IRequest, invoker: IRequestInvoker, interceptors: IRequestInterceptor[]): Promise<IInvokeResult> {
        return new Promise<IInvokeResult>((resolve, reject) => {
            let i = 0;
            let done = false;
            let current: IRequestInterceptorContext;
            const next: RequestInterceptorFunction = context => {
                current = context || current;
                if (!done) {
                    if (interceptors.length > i) {
                        const fn = interceptors[i++];
                        fn(current);

                        if (!fn.length) {
                            // manually invoke next if the interceptor function does not accept any arguments
                            next(current);
                        }
                    }
                    else {
                        // after invoking all the interceptors make the axios request
                        done = true;
                        // the request interceptors may have modified the request so pass the request from the context instead of using 'this'
                        invoker(current.request)
                            .then(resolve)
                            .catch(reject);
                    }
                }
            };

            next({
                request,
                next,
                resolve: response => {
                    done = true;
                    // check the response status to make sure it is an expected status; if so, resolve otherwise reject
                    if (isExpectedStatus(request, response.status)) {
                        resolve({
                            request,
                            response: {
                                request: request,
                                status: response.status,
                                data: response.data
                            }
                        });
                    }
                    else {
                        reject(createErrorForResponse(request, response));
                    }            
                },
                reject: error => {
                    done = true;
                    reject(error);
                }
            });
        });
    }

    /** 
     * Verify that the provided request is a request instance and that the request interceptor
     * instances are the same as the current instance. This is important because request interceptors
     * can modify/override a request but the internal state should carry forward. For example, a request
     * interceptor is expected to modify the request as follows:
     * 
     *     context.next({
     *         ...context,
     *         request: {
     *             ...context.request 
     *             // override request
     *         }
     *     })
     * 
     * -- OR --
     * 
     *     context.next({
     *         ...context,
     *         request: context.withHeader() // or some other helper extension function
     *     })
     */
    private static verifyRequest(request: IRequest): request is RequestInstance {
        return (<RequestInstance>request).requestInterceptors !== undefined && 
            (<RequestInstance>request).responseInterceptors !== undefined && 
            (<RequestInstance>request).options !== undefined;
    }
}