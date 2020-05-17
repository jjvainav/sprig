export * from "./authorization";

import { client } from "./client";
export default client;

export { 
    IEventStreamOptions, IRequest, IRequestInterceptor, IRequestInterceptorContext, IRequestOptions, 
    IRequestPromise, IResponse, IResponseInterceptor, IResponseInterceptorContext, isExpectedStatus, 
    RequestError, RequestErrorArgs, RequestErrorCode, RequestInterceptorFunction, ResponseInterceptorFunction
} from "./client";