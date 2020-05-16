import { IResponse, IResponseInterceptor, RequestError, RequestErrorCode, IResponseInterceptorContext } from "@sprig/request-client";

export type RetryEvent = { response?: IResponse, error?: RequestError };
type NotOptional<T> = { readonly [key in keyof T]-?: T[key] };

export interface IRetryOptions {
    readonly attempts?: number;
    readonly delay?: number;
    readonly retryError?: (error: RequestError) => boolean;
    readonly retryResponse?: ((response: IResponse) => boolean) | number[];
    readonly on?: (evt: RetryEvent) => Promise<void>;
}

const defaultRetryAttempts = 3;
const defaultRetryDelay = 0;
const defaultRetryOn = () => Promise.resolve();
const defaultRetryError = (error: RequestError) => error.code === RequestErrorCode.networkUnavailable || error.code === RequestErrorCode.timeout;
// by default do not retry for a failed response, this most likely indicates an error on the server and a retry probably won't be successful
const defaultRetryResponse = () => false;
const retryStatusCodes = (codes: number[]) => (response: IResponse) => {
    return codes.find(status => status === response.status) !== undefined;
};

function create(options: NotOptional<IRetryOptions>): IResponseInterceptor {
    let attempts = options.attempts;
    return async context => {
        if (!attempts || !shouldRetry(context, options)) {
            return context.next();
        }

        if (options.on) {
            await options.on({ 
                response: context.response,
                error: context.error
            });
        }

        attempts--;
        setTimeout(() => {
            // when attempting a retry call end to prevent interceptors farther down the chain from being invoked
            context.request.invoke()
                .then(response => context.end({
                    ...context,
                    response,
                    error: undefined
                }))
                .catch(error => context.end({
                    ...context,
                    response: undefined,
                    error
                }));
        }, 
        options.delay);
    };
}

function shouldRetry(context: IResponseInterceptorContext, options: NotOptional<IRetryOptions>): boolean {
    // it's possible that an http status code raises an error so grab the response from the error
    const response = context.response || (context.error && context.error.response);
    let result = false;

    if (response) {
        result = Array.isArray(options.retryResponse)
            ? retryStatusCodes(options.retryResponse)(response)
            : options.retryResponse(response);
    }

    if (context.error) {
        result = result || options.retryError(context.error);
    }

    return result;
}

/** An interceptor that will retry requests that failed. */
export function retry(options?: IRetryOptions): IResponseInterceptor {
    options = options || {};
    return create({
        attempts: options.attempts !== undefined ? options.attempts : defaultRetryAttempts,
        delay: options.delay !== undefined ? options.delay :  defaultRetryDelay,
        retryError: options.retryError || defaultRetryError,
        retryResponse: options.retryResponse || defaultRetryResponse,
        on: options.on || defaultRetryOn
    });
}