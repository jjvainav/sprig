import axios, { AxiosError, AxiosResponse } from "axios";
import EventSource from "eventsource";
import * as HttpStatus from "http-status-codes";
import { mocked } from "ts-jest/utils";
import { basicAuthentication } from "../src";
import client, { RequestErrorCode, RequestError } from "../src";

jest.mock("axios");
jest.genMockFromModule("eventsource");
jest.mock("eventsource");

interface IMockAxiosResponse {
    axiosErrorCode?: string;
    data?: any;
    status?: number;
    headers?: any;
    request?: any;
}

interface IMockEventSourceResponse {
    status?: number;
}

function mockAxiosisError() {
    const fn = mocked(axios.isAxiosError).mockImplementation(payload => {
        return typeof payload === "object" && payload.isAxiosError === true;
    });

    fn.mockClear();

    return fn.mock;
}

function mockAxiosResponse(response: IMockAxiosResponse) {
    mockAxiosisError();
    const fn = mocked(axios.request).mockImplementation(() => {
        if (response.axiosErrorCode) {
            const error = new Error("error") as AxiosError;
            (<any>error).isAxiosError = true;
            error.code = response.axiosErrorCode;
            error.request = {};
            error.config = {};

            return Promise.reject(error);
        }

        const axiosResponse = toAxiosResponse(response);

        if (axiosResponse.status >= 200 && axiosResponse.status < 300) {
            return Promise.resolve(axiosResponse);
        }

        const error = new Error("error") as AxiosError;
        (<any>error).isAxiosError = true;
        error.response = axiosResponse;
        error.request = {};
        error.config = {};

        return Promise.reject(error);
    });

    fn.mockClear();

    return fn.mock;
}

function mockEventSourceResponse(response?: IMockEventSourceResponse) {
    mockAxiosisError();

    response = response || {};
    response = response.status ? response : { ...response, status: 200 };

    const fn = mocked(EventSource).mockImplementation((url, options) => new class implements EventSource {
        private readonly listeners = new Map<string, EventListener[]>();

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
            const callbacks = this.listeners.get(type) || [];
            this.listeners.set(type, [...callbacks, listener]);   
        }

        dispatchEvent(evt: Event): boolean {
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
            (<any>this).readyState = this.CLOSED;
        }

        private connect(): void {
            if (response!.status === 200) {
                const event = new MessageEvent("open");
                (<any>event).status = response!.status;

                this.dispatchEvent(event);
                if (this.onopen !== null) {
                    this.onopen(event);
                }
            }
            else {
                const event = new MessageEvent("error");
                (<any>event).status = response!.status;

                this.dispatchEvent(event);
                if (this.onerror !== null) {
                    this.onerror(event);
                }
            }
        }
    });

    fn.mockClear();

    return fn.mock;
}

function toAxiosResponse(response: IMockAxiosResponse): AxiosResponse {
    return {
        data: response.data || {},
        status: response.status || 200,
        statusText: HttpStatus.getStatusText(response.status || 200),
        headers: response.headers || {},
        config: {},
        request: response.request
    }
}

describe("request", () => {
    test("with success status", async () => {
        mockAxiosResponse({ status: 200 });

        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke();

        expect(result.status).toBe(200);
    });

    test("with header option", async () => {
        mockAxiosResponse({ status: 200 });

        const result = await client.request({
            method: "GET",
            headers: { "Authorization": "Bearer token" },
            url: "http://localhost"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBe("Bearer token");
    });

    test("with header added using fluent request interface", async () => {
        mockAxiosResponse({ status: 200 });

        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .withHeader("Authorization", "Bearer token")
        .invoke();

        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBe("Bearer token");
    });

    test("with multiple headers added by request interceptors and fluent interface", async () => {
        mockAxiosResponse({ status: 200 });

        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .withHeader("Authorization", "Bearer token")
        .use(context => {
            context.next({
                ...context,
                request: context.request
                    .withHeader("X-Span-ID", "1")
                    .withHeader("X-Trace-ID", "2")
            });            
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBe("Bearer token");
        expect(result.request.options.headers!["X-Span-ID"]).toBeDefined();
        expect(result.request.options.headers!["X-Span-ID"]).toBe("1");
        expect(result.request.options.headers!["X-Trace-ID"]).toBeDefined();
        expect(result.request.options.headers!["X-Trace-ID"]).toBe("2");        
    });

    test("with auto generated request id", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        });

        const result = await request.invoke();

        expect(request.id).toBeDefined();
        expect(result.request.options.headers!["X-Request-ID"]).toBeDefined();
        expect(result.request.options.headers!["X-Request-ID"]).toBe(request.id);
    });

    test("with custom request id", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            headers: { "X-Request-ID": "request-id" },
            url: "http://localhost"
        });

        const result = await request.invoke();

        expect(request.id).toBe("request-id");
        expect(result.request.options.headers!["X-Request-ID"]).toBe("request-id");
    });

    test("with bad request status", async () => {
        mockAxiosResponse({ status: 400 });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke()
            .then(() => fail());

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.httpError);
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(400);
        }
    });  
    
    test("with timeout request status", async () => {
        mockAxiosResponse({ status: 408 });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke();

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.timeout);
            expect(err.response).toBeDefined();
            expect(err.response!.status).toBe(408);
        }
    }); 
    
    test("with axios abort error", async () => {
        mockAxiosResponse({ axiosErrorCode: "ECONNABORTED" });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke();

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.timeout);
            expect(err.response).toBeUndefined();
        }
    });  
    
    test("with unknown axios error", async () => {
        mockAxiosResponse({ axiosErrorCode: "UNKNOWN" });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke();

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.clientError);
            expect(err.response).toBeUndefined();
        }
    });

    test("with async request interceptor", async () => {
        mockAxiosResponse({ status: 200 });
        let value = "";

        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(() => value += "a")
        .use(context => setTimeout(() => {
            value += "b";
            context.next();
        }, 10))
        .use(context => setTimeout(() => {
            value += "c";
            context.next();
        }, 10))
        .use(() => value += "d")
        .use(() => value += "e")
        .invoke();

        expect(value).toBe("abcde");
    });

    test("with request interceptor that manually resolves", async () => {
        const mock = mockAxiosResponse({ status: 200 });
        
        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(context => {
            context.resolve({
                status: 201,
                data: {}
            });
        })
        .invoke();

        // make sure axios was not invoked
        expect(mock.calls).toHaveLength(0);
        expect(result.status).toBe(201);
    });

    test("with request interceptor that manually resolves with unexpected status code", async () => {
        const mock = mockAxiosResponse({ status: 200 });
        
        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .use(context => {
                context.resolve({
                    status: 401,
                    data: {}
                });
            })
            .invoke()
            .then(() => fail());

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.httpError);
            expect(err.response.status).toBe(401);
            // make sure axios was not invoked
            expect(mock.calls).toHaveLength(0);
        }
    });    

    test("with request interceptor that manually rejects", async () => {
        mockAxiosResponse({ status: 200 });
        
        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .use(context => {
                context.reject(new RequestError({
                    code: RequestErrorCode.networkUnavailable,
                    message: "",
                    request: context.request
                }));
            })
            .invoke();

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.networkUnavailable);
        }
    }); 

    test("with request interceptor that doesn't provide a new context", async () => {
        mockAxiosResponse({ status: 200 });
        
        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(context => context.next())
        .use(context => context.next({
            ...context,
            request: context.request.withHeader("Test", "foo")
        }))
        .use(context => context.next())
        .invoke();

        
        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Test"]).toBe("foo");
    });    

    test("with response interceptor", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(() => value = "hello");

        expect(value).toBe("hello");
    });

    test("with response interceptor added to request", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .withResponseInterceptor(() => value += "hello");

        await request.invoke();
        await request.invoke();

        // make sure the interceptor is invoked each time
        expect(value).toBe("hellohello");
    });

    test("with multiple response interceptors", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(() => value = value + "a")
        .thenUse(() => value = value + "b")
        .thenUse(() => value = value + "c");

        expect(value).toBe("abc");
    });

    test("with multiple response interceptors including an interceptor added to the request", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .withResponseInterceptor(() => value = value + "a")
        .withResponseInterceptor(() => value = value + "b")
        .invoke()
        .thenUse(() => value = value + "c");

        expect(value).toBe("abc");
    });

    test("with response interceptor that breaks interceptor chain", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        let final = "";

        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(() => value = value + "a")
        .thenUse(() => value = value + "b")
        // calling end skips the rest of the response interceptors
        .thenUse(context => context.end({
            ...context,
            response: {
                ...context.response!,
                data: value
            }
        }))
        .thenUse(() => value = value + "c")
        .then(response => final = response.data);

        expect(value).toBe("ab");
        expect(final).toBe("ab");
    });

    test("with response interceptor added to the request and breaks the interceptor chain", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        let final = "";

        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .withResponseInterceptor(() => value = value + "a")
        .withResponseInterceptor(() => value = value + "b")
        // calling end skips the rest of the response interceptors
        .withResponseInterceptor(context => context.end({
            ...context,
            response: {
                ...context.response!,
                data: value
            }
        }))
        .invoke()
        .thenUse(() => value = value + "c")
        .then(response => final = response.data);

        expect(value).toBe("ab");
        expect(final).toBe("ab");
    });

    test("with response interceptor that doesn't provide new context", async () => {
        mockAxiosResponse({ status: 200 });
        
        let value = "";
        let final = "";
        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(context => context.next())
        .thenUse(context => context.next())
        .thenUse(() => value = "1")
        .thenUse(context => context.next({
            ...context,
            response: {
                ...context.response!,
                data: value
            }
        }))
        .thenUse(context => context.end())
        .thenUse(() => value = value + "2")
        .then(response => final = response.data);

        expect(value).toBe("1");
        expect(final).toBe("1");
    });    
    
    test("with basic authentication header interceptor", async () => {
        mockAxiosResponse({ status: 200 });

        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(basicAuthentication("joe", "password"))
        .invoke();

        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]!.startsWith("Basic ")).toBeTruthy();
    });

    test("invoke multiple times with request interceptors", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(context => {
            context.next({
                ...context,
                request: context.request.withHeader("X-Span-ID", "1")
            });            
        })
        .use(context => {
            context.next({
                ...context,
                request: context.request.withHeader("X-Trace-ID", "2")
            });            
        });

        const result1 = await request.invoke();
        const result2 = await request.invoke();

        expect(result1.request.options.headers!["X-Span-ID"]).toBe("1");
        expect(result1.request.options.headers!["X-Trace-ID"]).toBe("2");

        expect(result2.request.options.headers!["X-Span-ID"]).toBe("1");
        expect(result2.request.options.headers!["X-Trace-ID"]).toBe("2");

        expect(result1.request.options.headers!["X-Request-ID"]).toBe(result2.request.options.headers!["X-Request-ID"]);
    }); 
    
    test("invoke multiple times with different response interceptors", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        });

        let count1 = 0;
        let count2 = 0;

        await request.invoke().thenUse(context => {
            count1++;
            context.next();
        });

        await request.invoke().thenUse(context => {
            count2++;
            context.next();
        });

        expect(count1).toBe(1);
        expect(count2).toBe(1);
    });    
    
    test("invoke request from response interceptor", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        });

        let flag = false;
        let result = "";
        await request.invoke()
            .thenUse(context => {
                result += "a";
                context.next();
            })
            .thenUse(async context => {
                if (!flag) {
                    flag = true;
                    result += "b";
                    // invoking the request again should retain the response interceptors 
                    await context.request.invoke();
                    context.next();
                }
                else {
                    context.end();
                }
            })
            .thenUse(context => {
                result += "c";
                context.next();
            });

        expect(result).toBe("abac");
    });
    
    test("invoke request from response interceptor added to the request", async () => {
        mockAxiosResponse({ status: 200 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        });

        let flag = false;
        let result = "";

        await request
            .withResponseInterceptor(context => {
                result += "a";
                context.next();
            })
            .withResponseInterceptor(async context => {
                if (!flag) {
                    flag = true;
                    result += "b";
                    // invoking the request again should retain the response interceptors 
                    await context.request.invoke();
                    context.next();
                }
                else {
                    context.end();
                }
            })
            .withResponseInterceptor(context => {
                result += "c";
                context.next();
            })
            .invoke();

        expect(result).toBe("abac");
    });
});

describe("stream", () => {
    test("with success status", async () => {
        mockEventSourceResponse();

        const result = await client.stream({ 
            method: "GET",
            url: "http://localhost" 
        })
        .invoke();

        expect(result.status).toBe(200);
        expect((<EventSource>result.data).onopen).toBeDefined();
        expect((<EventSource>result.data).onopen).toBeNull();
        expect((<EventSource>result.data).onerror).toBeNull();
        expect((<EventSource>result.data).onmessage).toBeNull();
    });

    test("with header option", async () => {
        mockEventSourceResponse();

        const result = await client.stream({
            method: "GET",
            headers: { "Authorization": "Bearer token" },
            url: "http://localhost"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBe("Bearer token");

        expect(result.data.options.headers).toBeDefined();
        expect(result.data.options.headers!["Authorization"]).toBeDefined();
        expect(result.data.options.headers!["Authorization"]).toBe("Bearer token");
    });

    test("with multiple headers added by request interceptors and fluent interface", async () => {
        mockEventSourceResponse();

        const result = await client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .withHeader("Authorization", "Bearer token")
        .use(context => {
            context.next({
                ...context,
                request: context.request
                    .withHeader("X-Span-ID", "1")
                    .withHeader("X-Trace-ID", "2")
            });            
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.request.options.headers).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBeDefined();
        expect(result.request.options.headers!["Authorization"]).toBe("Bearer token");
        expect(result.request.options.headers!["X-Span-ID"]).toBeDefined();
        expect(result.request.options.headers!["X-Span-ID"]).toBe("1");
        expect(result.request.options.headers!["X-Trace-ID"]).toBeDefined();
        expect(result.request.options.headers!["X-Trace-ID"]).toBe("2"); 
        
        expect(result.data.options.headers).toBeDefined();
        expect(result.data.options.headers!["Authorization"]).toBeDefined();
        expect(result.data.options.headers!["Authorization"]).toBe("Bearer token");
        expect(result.data.options.headers!["X-Span-ID"]).toBeDefined();
        expect(result.data.options.headers!["X-Span-ID"]).toBe("1");
        expect(result.data.options.headers!["X-Trace-ID"]).toBeDefined();
        expect(result.data.options.headers!["X-Trace-ID"]).toBe("2"); 
    });

    test("with multiple response interceptors", async () => {
        mockEventSourceResponse();
        
        let value = "";
        await client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(() => value = value + "a")
        .thenUse(() => value = value + "b")
        .thenUse(() => value = value + "c");

        expect(value).toBe("abc");
    });

    test("with failed connection", async () => {
        mockEventSourceResponse({ status: 406 });
        
        let error: RequestError | undefined;
        await client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .catch(err => error = err);

        expect(error).toBeDefined();
        expect(error!.code).toBe(RequestErrorCode.httpError);
        expect(error!.response).toBeDefined();
        expect(error!.response!.status).toBe(406);
    });
});