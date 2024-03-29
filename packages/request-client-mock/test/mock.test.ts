// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "../src";
import client, { IRequestOptions, RequestError, RequestErrorCode } from "@sprig/request-client/dist/polyfill";
import EventSource from "eventsource";

describe("client request mock", () => {
    beforeEach(mockClear);

    test("mock response", async () => {
        // a simple test to ensure the mock is hooking into axios properly
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.data.foo).toBe("bar");
    });

    test("mock response with bad request status", async () => {
        mockResponse({ 
            status: 400,
            data: { foo: "bar" }
        });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost/foo"
            })
            .invoke();

            fail();
        }
        catch(err: any) {
            expect(err.code).toBe("http-error");
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(400);
        }
    }); 

    test("mock response with unexpected status", async () => {
        mockResponse({ 
            status: 403,
            data: { foo: "bar" }
        });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost/foo",
                expectedStatus: [200, 400]
            })
            .invoke();

            fail();
        }
        catch(err: any) {
            expect(err.code).toBe("http-error");
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(403);
        }
    });     

    test("mock response with bad request status as expected", async () => {
        mockResponse({ 
            status: 400,
            data: { foo: "bar" }
        });

        const result = await client.request({
            method: "GET",
            url: "http://localhost",
            expectedStatus: [400]
        })
        .invoke();

        expect(result.status).toBe(400);
        expect(result.data.foo).toBe("bar");
    });     

    test("mock response with path", async () => {
        mockResponse({ 
            path: "/foo",
            status: 200,
            data: { foo: "bar" }
        });

        const result = await client.request({
            method: "GET",
            url: "http://localhost/foo"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.data.foo).toBe("bar");
    }); 
    
    test("mock response with complex path", async () => {
        mockResponse({ 
            path: "/foo",
            status: 200,
            data: { foo: "bar" }
        });

        const result = await client.request({
            method: "GET",
            url: "http://localhost/foo?bar=1"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.data.foo).toBe("bar");
    });  
    
    test("mock response with unknown path", async () => {
        mockResponse({ 
            status: 200,
            data: { foo: "1" }
        });

        mockResponse({ 
            path: "/foo",
            status: 200,
            data: { foo: "2" }
        });

        const result = await client.request({
            method: "GET",
            url: "http://localhost/bar"
        })
        .invoke();

        expect(result.status).toBe(200);
        expect(result.data.foo).toBe("1");
    });     

    test("mock multiple responses", async () => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const options: IRequestOptions = { method: "GET", url: "http://localhost" };
        const result1 = await client.request(options).invoke();

        // this should overwrite the last response registered
        mockResponse({ 
            status: 200,
            data: { foo: "bar2" }
        });

        const result2 = await client.request(options).invoke();

        expect(result1.status).toBe(200);
        expect(result1.data.foo).toBe("bar");
        expect(result2.status).toBe(200);
        expect(result2.data.foo).toBe("bar2");
    }); 
    
    test("mock multiple responses representing different paths", async () => {
        mockResponse({ 
            path: "/foo",
            status: 200,
            data: { foo: "foo" }
        }, { 
            path: "/bar",
            status: 200,
            data: { bar: "bar" }
        });

        const result1 = await client.request({
            method: "GET",
            url: "http://localhost/foo"
        })
        .invoke();

        const result2 = await client.request({
            method: "GET",
            url: "http://localhost/bar"
        })
        .invoke();

        expect(result1.status).toBe(200);
        expect(result1.data.foo).toBe("foo");
        expect(result2.status).toBe(200);
        expect(result2.data.bar).toBe("bar");
    });     

    test("invoke request multiple times", async () => {
        const context = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        });

        await request.invoke();
        await request.invoke();

        expect(context.requests).toHaveLength(2);
    });

    test("invoke multiple pre-existing requests", async () => {
        mockResponse({
            path: "/foo",
            status: 200,
            data: { foo: "foo" }
        }, {
            path: "/bar",
            status: 200,
            data: { bar: "bar" }
        });

        const fooRequest = client.request({
            method: "GET",
            url: "http://localhost/foo"
        });

        const barRequest = client.request({
            method: "GET",
            url: "http://localhost/bar"
        });

        const fooResult = await fooRequest.invoke();
        const barResult = await barRequest.invoke();

        expect(fooResult.data.foo).toBe("foo");
        expect(barResult.data.bar).toBe("bar");
    });

    test("mocked request function", async () => {
        // a simple test to ensure the mock request function is hooked up properly
        const request = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke();

        expect(request.mockRequest.calls).toHaveLength(1);
        expect(request.requests).toHaveLength(1);
        expect(request.requests[0].method).toBe("GET");
        expect(request.requests[0].url).toBe("http://localhost");
    });

    test("mocked request function invoked multiple times", async () => {
        const request = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        await client.request({ method: "GET", url: "http://localhost" }).invoke();
        await client.request({ method: "GET", url: "http://localhost" }).invoke();
        await client.request({ method: "GET", url: "http://localhost" }).invoke();

        expect(request.mockRequest.calls).toHaveLength(3);
        expect(request.requests).toHaveLength(3);
    });    

    test("clear mocked request function information", async () => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        await client.request({ method: "GET", url: "http://localhost" }).invoke();
        await client.request({ method: "GET", url: "http://localhost" }).invoke();

        mockClear();
        const request = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        await client.request({ method: "GET", url: "http://localhost" }).invoke();

        expect(request.mockRequest.calls).toHaveLength(1);
        expect(request.requests).toHaveLength(1);
    });    
});

describe("client stream mock", () => {
    beforeEach(mockClear);

    test("mock response", done => {
        // a simple test to ensure the mock is hooking into the EventSource properly
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .then(result => {
            const source = <EventSource>result.data;
            source.onmessage = e => {
                expect(e.data.foo).toBe("bar");
                done();
            };
        })
        .catch(err => done(err));
    });

    test("mock response with bad request status", async () => {
        mockResponse({ status: 406 });

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
    
    test("send multiple messages", done => {
        const context = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .then(result => {
            let count = 0;
            const source = <EventSource>result.data;
            source.onmessage = e => {
                count++;
                if (count === 3) {
                    done();
                }
            };
    
            // this needs to be sent after the onmessage has been attached
            context.sendEventSourceMessage({ foo: "bar" });
            context.sendEventSourceMessage({ foo: "bar" });
        })
        .catch(err => done(err));
    });
});