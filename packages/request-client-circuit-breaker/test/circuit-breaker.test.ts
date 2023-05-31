// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import client, { RequestErrorCode } from "@sprig/request-client/dist/polyfill";
import { retry } from "@sprig/request-client-retry";
import { CircuitBreakerState, createCircuitBreaker, useCircuitBreaker } from "../src"

describe("request circuit breaker", () => { 
    beforeEach(() => {
        mockClear();
    });

    test("with circuit breaker that trips open", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(circuitBreaker);

        // trip the circuit so it becomes open
        for (let i = 0; i < 4; i++) {
            try {
                await request.invoke().thenUse(circuitBreaker.metrics);
                fail();
            }
            catch (err: any) {
                if (i === 0) {
                    // the first requests should fail with a timeout status and the circuit should be closed
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.closed);
                }
                else if (i === 1) {
                    // the second request should fail with a timeout status but then the circuit breaker shoud now be in an open state because of the failure
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
                }                
                else {
                    // then the circuit breaker should now be open and rejecting requests with service unavailable
                    expect(err.code).toBe(RequestErrorCode.serviceUnavailable);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
                }
            }
        }
    }); 
    
    test("with circuit breaker added using the helper function and trips open", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        const request = useCircuitBreaker(
            client.request({ method: "GET", url: "http://localhost" }),
            circuitBreaker);

        // trip the circuit so it becomes open
        for (let i = 0; i < 4; i++) {
            try {
                await request.invoke();
                fail();
            }
            catch (err: any) {
                if (i === 0) {
                    // the first requests should fail with a timeout status and the circuit should be closed
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.closed);
                }
                else if (i === 1) {
                    // the second request should fail with a timeout status but then the circuit breaker shoud now be in an open state because of the failure
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
                }                
                else {
                    // then the circuit breaker should now be open and rejecting requests with service unavailable
                    expect(err.code).toBe(RequestErrorCode.serviceUnavailable);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
                }
            }
        }
    }); 
    
    test("with circuit breaker that transitions from open to half-open", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(circuitBreaker);

        // trip the circuit so it becomes open
        for (let i = 0; i < 3; i++) {
            try {
                await request.invoke().thenUse(circuitBreaker.metrics);
                fail();
            }
            catch (err: any) {
            }
        }

        // allow the circuit breaker time so it will switch to the half-open state
        await new Promise(resolve => setTimeout(resolve, 600));

        // simulate a successful response
        mockResponse({ status: 200 });

        // make sure the half-open state allows a request through by checking for a response
        let result: any;
        await request.invoke().then(response => result = response.data);

        expect(circuitBreaker.state).toBe(CircuitBreakerState.halfOpen);
        expect(result).toBeDefined();        
    });  

    test("with circuit breaker that transitions from half-open to open", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(circuitBreaker);

        // trip the circuit so it becomes open
        for (let i = 0; i < 3; i++) {
            try {
                await request.invoke().thenUse(circuitBreaker.metrics);
                fail();
            }
            catch (err: any) {
            }
        }

        // allow the circuit breaker time so it will switch to the half-open state
        await new Promise(resolve => setTimeout(resolve, 600));

        // simulate a successful response
        mockResponse({ status: 408 });

        // the circuit breaker should be half-open, trip it so it becomes open
        for (let i = 0; i < 3; i++) {
            try {
                await request.invoke().thenUse(circuitBreaker.metrics);
                fail();
            }
            catch (err: any) {
                if (i === 0) {
                    // the first requests should fail with a timeout status and the circuit should be half-open at this point
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.halfOpen);
                }
                else if (i === 1) {
                    // the second request should fail with a timeout status but then the circuit breaker shoud now be open again
                    expect(err.code).toBe(RequestErrorCode.timeout);
                    expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
                }              
            }
        }
    });
    
    test("with circuit breaker that transitions from half-open to closed", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(circuitBreaker);

        // trip the circuit so it becomes open
        for (let i = 0; i < 4; i++) {
            try {
                await request.invoke().thenUse(circuitBreaker.metrics);
                fail();
            }
            catch (err: any) {
            }
        }

        // allow the circuit breaker time so it will switch to the half-open state
        await new Promise(resolve => setTimeout(resolve, 600));

        // simulate a successful response
        mockResponse({ status: 200 });

        // the circuit breaker should be half-open send some successful requests so it can transition to closed
        for (let i = 0; i < 3; i++) {
            await request.invoke().thenUse(circuitBreaker.metrics);
        }

        expect(circuitBreaker.state).toBe(CircuitBreakerState.closed);
    });      

    test("with circuit breaker and retry", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        let count = 0;
        const request = client.request({
            method: "GET",
            url: "http://localhost"
        })
        .use(context => {
            count++;
            context.next();
        })
        .use(circuitBreaker);

        try {
            await request.invoke()
                .thenUse(circuitBreaker.metrics)
                .thenUse(retry({ attempts: 2 }));

            fail();
        }
        catch(err: any) {
            // 1 for the initial request and 2 for the retry attempts
            expect(count).toBe(3);
            // the retry interceptor will prevent the request from throwing an error until all the retry attempts
            // are done; at which point, the circuit breaker's service-unavailable error should get thrown.
            expect(err.code).toBe(RequestErrorCode.serviceUnavailable);
            expect(circuitBreaker.state).toBe(CircuitBreakerState.open);
        }
    });

    test("with circuit breaker that comes after retry", async () => {
        const circuitBreaker = createCircuitBreaker({
            name: "test",
            openDuration: 500,
            bufferSizeClosed: 2,
            bufferSizeHalfOpen: 2
        });

        mockResponse({ status: 408 });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .use(circuitBreaker)
            .invoke()
            .thenUse(retry({ attempts: 2 }))
            .thenUse(circuitBreaker.metrics);

            fail();
        }
        catch(err: any) {
            // in this use-case the retry interceptor performs its retries before the circuit breaker tracks error/success
            // so even though the request will fail multiple times the circuit breaker only captures 1 failure and will thus still be closed
            expect(err.code).toBe(RequestErrorCode.timeout);
            expect(circuitBreaker.state).toBe(CircuitBreakerState.closed);
        }        
    });    
});