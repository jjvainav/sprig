// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import { ReadyState, RequestEventStream } from "../src"

describe("request event stream", () => { 
    beforeEach(() => {
        mockClear();
    });

    test("on message received", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        stream.onMessage(e => {
            expect(e.data.foo).toBe("bar");
            done();
        });
    });

    test("on multiple messages received", async done => {
        const context = mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        let count = 0;
        stream.onMessage(e => {
            count++;
            if (count === 3) {
                done();
            }
        });

        context.sendEventSourceMessage({ foo: "bar" });
        context.sendEventSourceMessage({ foo: "bar" });
    });

    test("on connection with server failed", async done => {
        // note: an EventSource does not provide access to the failed response body
        mockResponse({ status: 400 });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        stream.connect();
        stream.onError(e => {
            expect(e.type).toBe("http");
            expect(e.response).toBeDefined();
            expect(e.response!.status).toBe(400);
            done();
        });
    });

    test("with custom validator", async done => {
        mockResponse({ status: 200, data: "100" });

        const stream = new RequestEventStream<number>({
            method: "GET",
            url: "http://localhost",
            validate: (data, resolve) => resolve(Number.parseInt(data))
        });

        stream.onMessage(e => {
            expect(e.data).toBe(100);
            done();
        });
    });

    test("with invalid data received", async done => {
        mockResponse({ status: 200, data: "foo" });

        const stream = new RequestEventStream<number>({
            method: "GET",
            url: "http://localhost",
            validate: (data, _, reject) => reject("Data is not a number.")
        });

        let onMessageRaised = false;
        stream.onMessage(e => onMessageRaised = true);
        stream.onInvalidData(() => {
            expect(onMessageRaised).toBe(false);
            done();
        });
    });

    test("verify lazy connect", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({ url: "http://localhost" });

        expect(stream.readyState).toBe(ReadyState.closed);
        stream.onMessage(() => {
            expect(stream.readyState).toBe(ReadyState.open);
            expect(onOpenRaised).toBe(true);
            done();
        });

        let onOpenRaised = false;
        stream.onOpen(() => {
            onOpenRaised = true;
            expect(stream.readyState).toBe(ReadyState.open);
        });
    });

    test("verify immediate auto close", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        stream.onClose(() => {
            expect(stream.readyState).toBe(ReadyState.closed);
            done();
        });

        stream.onMessage(() => {}).remove();
    });

    test("verify lazy auto close", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        stream.onClose(() => {
            expect(stream.readyState).toBe(ReadyState.closed);
            done();
        });

        // need to wait for the stream to open before removing and closing
        stream.onOpen(() => listener.remove());
        const listener = stream.onMessage(() => {});
    });
});