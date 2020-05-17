// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import { RequestEventStream } from "../src"

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

    test("verify lazy connect", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const stream = new RequestEventStream({
            method: "GET",
            url: "http://localhost"
        });

        stream.onOpen(() => {
            expect(stream.isConnected).toBe(true);
            done();
        });

        expect(stream.isConnected).toBe(false);
        stream.onMessage(() => {});
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
            expect(stream.isConnected).toBe(false);
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
            expect(stream.isConnected).toBe(false);
            done();
        });

        // need to wait for the stream to open before removing and closing
        stream.onOpen(() => listener.remove());
        const listener = stream.onMessage(() => {});
    });
});