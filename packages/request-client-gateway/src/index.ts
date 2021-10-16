import { IRequestClient, IRequestOptions, IResponse } from "@sprig/request-client/dist/common";

/** Defines a constructor for a request client. */
export type RequestClientGatewayConstructor<TGateway> = { new(options: IRequestClientGatewayOptions): TGateway };

/** Defines options for a request client gateway. */
export interface IRequestClientGatewayOptions {
    /** The base url for the endpoint. */
    readonly url: string;
    /** The request client to use with the gateway. */
    readonly client: IRequestClient;
}

/** A class that wraps and exposes API calls as functions. */
export abstract class RequestClientGateway {
    constructor(private readonly options: IRequestClientGatewayOptions) {
    }

    get url(): string {
        return this.options.url;
    }

    protected invokeRequest<TResult>(options: IRequestOptions, handleResponse: (response: IResponse) => TResult | Promise<TResult>): Promise<TResult> {
        return this.options.client.request(options).invoke().then(handleResponse);
    }
}