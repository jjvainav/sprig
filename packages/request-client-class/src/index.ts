import { IEventStreamOptions, IRequestClient, IRequestOptions, IResponse } from "@sprig/request-client/dist/common";

/** Defines a constructor for a request client class. */
export type RequestClientConstructor<TClient> = { new(options: IRequestClientOptions): TClient };

/** Defines options for a request client class. */
export interface IRequestClientOptions {
    /** The base url for the endpoint. */
    readonly url: string;
    /** The underlying request client used by the class to invoke the endpoint. */
    readonly client: IRequestClient;
}

/** A class that wraps and exposes requests as functions. */
export abstract class RequestClient {
    constructor(private readonly options: IRequestClientOptions) {
    }

    get url(): string {
        return this.options.url;
    }

    protected invokeRequest<TResult>(options: IRequestOptions, handleResponse: (response: IResponse) => TResult | Promise<TResult>): Promise<TResult> {
        return this.options.client.request(options).invoke().then(handleResponse);
    }

    protected invokeStream<TResult>(options: IEventStreamOptions, handleResponse: (response: IResponse) => TResult | Promise<TResult>): Promise<TResult> {
        return this.options.client.stream(options).invoke().then(handleResponse);
    }
}