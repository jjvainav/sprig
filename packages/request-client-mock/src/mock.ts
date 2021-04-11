// put this at the top to prevent any hoisting issues with TS and jest
jest.mock("axios");
jest.genMockFromModule("eventsource");
jest.mock("eventsource");

import axios, { AxiosError, AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import EventSource, { EventSourceInitDict } from "eventsource";
import * as HttpStatus from "http-status-codes";
import { mocked } from "ts-jest/utils";
import * as url from "url";
import client, { IEventStreamOptions, IRequestClient, IRequestOptions } from "@sprig/request-client";

type Mutable<T> = { -readonly[P in keyof T]: T[P] };

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
    /** Sends a message to all mock event source implementations. */
    sendEventSourceMessage(data: any): void;
}

interface IMockEventSource extends EventSource {
    sendMessage(data: any): void;
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
    private readonly listeners = new Map<string, EventListener[]>();
    private readonly pending: any[] = [];
    private _readyState = 0;

    readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly options = options;
    readonly url = url;
    readonly withCredentials = false;

    onopen!: (evt: MessageEvent) => any;
    onmessage!: (evt: MessageEvent) => any;
    onerror!: (evt: MessageEvent) => any;

    constructor() {
        (<any>this).onopen = null;
        (<any>this).onmessage = null;
        (<any>this).onerror = null;

        eventSourceInstances.push(this);
        setTimeout(() => this.connect(), 0);
    }

    get readyState(): number {
        return this._readyState;
    }

    addEventListener(type: string, listener: EventListener): void {
        const callbacks = this.listeners.get(type) || [];
        this.listeners.set(type, [...callbacks, listener]);
    }

    dispatchEvent(evt: Event): boolean {
        const callback = (<any>this)["on" + evt.type];
        if (callback !== null) {
            callback(evt);
        }

        const callbacks = this.listeners.get(evt.type);
        if (callbacks) {
            callbacks.forEach(callback => callback(evt));
        }

        return true;
    }

    removeEventListener(type: string, listener?: EventListener): void {
        if (!listener) {
            this.listeners.set(type, []);
        }
        else {
            const callbacks = this.listeners.get(type);
            if (callbacks) {
                for (let i = 0; i < callbacks.length; i++) {
                    if (callbacks[i] === listener) {
                        callbacks.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }

    close(): void {
        this._readyState = this.CLOSED;
    }

    sendMessage(data: any): void {
        setTimeout(() => {
            if (this._readyState !== this.OPEN) {
                this.pending.push(data);
                return;
            }

            const event = new MessageEvent("message", { data });
            (<any>event).status = 200;
            this.dispatchEvent(event); 
        },
        0);
    }

    private connect(): void {
        const url = this.url || "/";
        const currentRequest = requests.get(url);
    
        if (!currentRequest) {
            throw new Error(`EventSource invoked with url (${url}) and no client request was captured.`);
        }

        this._readyState = this.CONNECTING;

        invokedRequests.push(currentRequest);
        const response = getResponse(currentRequest);

        setTimeout(() => {
            if (response.status === 200) {
                const event = new MessageEvent("open");
                (<any>event).status = response!.status;
                this._readyState = this.OPEN;
                this.dispatchEvent(event);

                if (response.data) {
                    this.sendMessage(response.data);
                }   
                
                this.pending.forEach(data => this.sendMessage(data));
                this.pending.splice(0);
            }
            else {
                const event = new MessageEvent("error");
                (<any>event).status = response!.status;
                // TODO: an event source will be closed if an error occurs during connection but what about if an error happens after the connection is already open?
                this._readyState = this.CLOSED;
                this.dispatchEvent(event);
            }
        },
        0);
    }
});

const eventSourceInstances: IMockEventSource[] = [];
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
    },
    sendEventSourceMessage(data: any): void {
        eventSourceInstances.forEach(eventSource => eventSource.sendMessage(data));
    }
};

const __request = client.request;
(<Mutable<IRequestClient>>client).request = (options: IRequestOptions) => {
    requests.set(options.url || "/", options);
    return __request(options);
};

const __stream = client.stream;
(<Mutable<IRequestClient>>client).stream = (options: IEventStreamOptions) => {
    requests.set(options.url || "/", options);
    return __stream(options);
};

/** Clears all the saved and captured state for the request mock. */
export function mockClear(): void {
    mockEventSource.mockClear();
    mockRequest.mockClear();
    eventSourceInstances.splice(0);
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