// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import client, { RequestErrorCode } from "@sprig/request-client";
import { retry } from "../src"

describe("request retry", () => { 
    beforeEach(() => {
        mockClear();
    });

    test("with interceptor", async () => {
        mockResponse({ status: 500 });

        let countBefore = 0;
        let countAfter = 0;

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke()
            .thenUse(() => countBefore++)
            .thenUse(retry({
                attempts: 3,
                retryResponse: [500]
            }))
            .thenUse(() => countAfter++);

            fail();
        }
        catch(err) {
            expect(countBefore).toBe(4); // one for the first request and three retries
            expect(countAfter).toBe(1);
            expect(err.code).toBe(RequestErrorCode.httpError);
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(500);
        }
    });

    test("with interceptor add to request", async () => {
        mockResponse({ status: 500 });

        let countBefore = 0;
        let countAfter = 0;

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .withResponseInterceptor(() => countBefore++)
            .withResponseInterceptor(retry({
                attempts: 3,
                retryResponse: [500]
            }))
            .invoke()
            .thenUse(() => countAfter++);

            fail();
        }
        catch(err) {
            expect(countBefore).toBe(4); // one for the first request and three retries
            expect(countAfter).toBe(1);
            expect(err.code).toBe(RequestErrorCode.httpError);
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(500);
        }
    });
    
    test("with retry handler and event callbacks", async () => {
        mockResponse({ status: 500 });

        let count = 0;
        
        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke()
            .thenUse(retry({ 
                attempts: 3,
                retryResponse: response => response.status === 500,
                on: () => { 
                    count++;
                    return Promise.resolve();
                }
            }));
            
            fail();
        }
        catch(err) {
            expect(count).toBe(3);
            expect(err.code).toBe(RequestErrorCode.httpError);
            expect(err.response).toBeDefined();
            expect(err.response.status).toBe(500);
        }
    });

    test("with retry interceptor that succeeds on first retry", async () => {
        mockResponse({ status: 500 });

        let count = 0;
        const response = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(retry({ 
            attempts: 3,
            retryResponse: response => response.status === 500,
            on: () => { 
                count++;
                mockResponse({ status: 200 });
                return Promise.resolve();
            }
        }));

        expect(count).toBe(1);
        expect(response.status).toBe(200);
    });  
});