// put this at the top to prevent any hoisting issues with TS and jest
jest.mock("axios");
jest.genMockFromModule("eventsource");
jest.mock("eventsource");

import axios, { AxiosError, AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import EventSource, { EventSourceInitDict } from "eventsource";
import * as HttpStatus from "http-status-codes";
import { mocked } from "ts-jest/utils";
import * as url from "url";
import client, { IRequestOptions } from "@sprig/request-client";

export interface IMockResponse {
    data?: any;
    status?: number;
    headers?: any;
}

/** Defines options for setting up a mock response. */
export interface IMockResponseOptions extends IMockResponse {
    /** An optional uri path useful for mocking multiple responses; if left empty, the response will be registered as a fallback and used for any requests that do not match any registered responses. */
    readonly path?: string;
}

export interface IMockRequestContext {
    /** The jest mock context for the EventSource used for a client stream. */
    readonly mockEventSource: jest.MockContext<EventSource, [string, (EventSourceInitDict | undefined)?]>;
    /** The jest mock context for the Axios request function. */
    readonly mockRequest: jest.MockContext<AxiosPromise, [AxiosRequestConfig]>;
    /** A list of requests. */
    readonly requests: IRequestOptions[];
}

const requests = new Map<string, IRequestOptions>();
const responses = new Map<string, IMockResponse>();

const mockRequest = mocked(axios.request);    
mockRequest.mockImplementation(config => {
    const url = config.url || "/";
    const currentRequest = requests.get(url);

    if (!currentRequest) {
        throw new Error(`axios.request invoked with url (${url}) and no client request was captured; this most likely occurred because axios was invoked directly and not through client.request.`);
    }

    invokedRequests.push(currentRequest);

    const axiosResponse = toAxiosResponse(currentRequest, getResponse(currentRequest));
    const isValid = Array.isArray(currentRequest.expectedStatus)
        ? currentRequest.expectedStatus.indexOf(axiosResponse.status) > -1
        : currentRequest.expectedStatus
            ? currentRequest.expectedStatus(axiosResponse.status)
            : axiosResponse.status >= 200 && axiosResponse.status < 300; // default axios behavior
    
    if (isValid) {
        return Promise.resolve(axiosResponse);
    }

    const error = new Error("mock error") as AxiosError;
    (<any>error).isAxiosError = true;
    error.response = axiosResponse;
    error.request = axiosResponse.request;
    error.config = {};

    return Promise.reject(error);    
});

const mockEventSource = mocked(EventSource);
mockEventSource.mockImplementation((url, options) => new class implements EventSource {
    readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly options = options;
    readonly url = url;
    readonly readyState = 0;
    readonly withCredentials = false;

    onopen!: (evt: MessageEvent) => any;
    onmessage!: (evt: MessageEvent) => any;
    onerror!: (evt: MessageEvent) => any;

    constructor() {
        (<any>this).onopen = null;
        (<any>this).onmessage = null;
        (<any>this).onerror = null;

        setTimeout(() => this.connect(), 0);
    }

    addEventListener(type: string, listener: EventListener): void {
        throw new Error("Not implemented.");
    }

    dispatchEvent(evt: Event): boolean {
        throw new Error("Not implemented.");
    }

    removeEventListener(type: string, listener?: EventListener): void {
        throw new Error("Not implemented.");
    }

    close(): void {
        (<any>this).readyState = this.CLOSED;
    }

    private connect(): void {
        const url = this.url || "/";
        const currentRequest = requests.get(url);
    
        if (!currentRequest) {
            throw new Error(`EventSource invoked with url (${url}) and no client request was captured.`);
        }

        invokedRequests.push(currentRequest);
        const response = getResponse(currentRequest);

        if (response.status === 200) {
            if (this.onopen !== null) {
                const event = new MessageEvent("");
                (<any>event).status = response.status;
                this.onopen(event);
            }
        }
        else if (this.onerror !== null) {
            const event = new MessageEvent("error");
            (<any>event).status = response.status;
            this.onerror(event);
        }

        if (response.status === 200 && response.data) {
            setTimeout(() => {
                if (this.onmessage) {
                    const event = new MessageEvent("", { data: response.data });
                    (<any>event).status = response.status;
                    this.onmessage(event); 
                }
            }, 0);
        }
    }
});

const invokedRequests: IRequestOptions[] = [];
const mockContext: IMockRequestContext = {
    get mockEventSource(): jest.MockContext<EventSource, [string, (EventSourceInitDict | undefined)?]> { 
        return mockEventSource.mock;
    },
    get mockRequest(): jest.MockContext<AxiosPromise, [AxiosRequestConfig]> { 
        return <jest.MockContext<AxiosPromise, [AxiosRequestConfig]>>mockRequest.mock;
    },
    get requests(): IRequestOptions[] {
        return invokedRequests;
    }
};

const __request = client.request;
client.request = options => {
    requests.set(options.url || "/", options);
    return __request(options);
};

const __stream = client.stream;
client.stream = options => {
    requests.set(options.url || "/", options);
    return __stream(options);
};

/** Clears all the saved and captured state for the request mock. */
export function mockClear(): void {
    mockEventSource.mockClear();
    mockRequest.mockClear();
    invokedRequests.splice(0);
    requests.clear();
    responses.clear();
}

/** 
 * Mocks a request client response for Jest tests. Invoke this function before 
 * calling client.request to mock a response for the request. This mocks the 
 * underlying Axios client and returns the mocked request context.
 */
export function mockResponse(...options: IMockResponseOptions[]): IMockRequestContext {
    for (const response of options) {
        const path = response.path
            ? url.parse(response.path).pathname || "/"
            : "";

        saveResponse(path, {
            data: response.data,
            status: response.status,
            headers: response.headers
        });
    }

    return mockContext;
}

function getResponse(request: IRequestOptions): IMockResponse {
    const path = normalizePath(request.url 
        ? url.parse(request.url).pathname || "/"
        : "/");

    let response = responses.get(path);

    if (!response) {
        response = responses.get("");
    }

    if (!response) {
        throw new Error(`Unable to locate mock response for url (${request.url}) matching path (${path}) and no fallback response registered.`);
    }

    return response;
}

function saveResponse(path: string, response: IMockResponse): void {
    path = normalizePath(path);
    responses.set(path, response);
} 

function normalizePath(path: string): string {
    path.trim();

    if (path) {
        path = path[0] === "/" ? path : "/" + path;

        if (path.length > 1) {
            path = path[path.length - 1] !== "/" ? path : path.substr(0, path.length - 1);
        }
    }

    return path;
}

function toAxiosResponse(request: IRequestOptions, response: IMockResponse): AxiosResponse {
    return {
        data: response.data || {},
        status: response.status || 200,
        statusText: HttpStatus.getStatusText(response.status || 200),
        headers: response.headers || {},
        config: {},
        request: {
            url: request.url,
            method: request.method,
            data: request.data
        }
    }
}