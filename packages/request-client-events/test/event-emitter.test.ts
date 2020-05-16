// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";

import { IEvent } from "@sprig/event-emitter";
import client from "@sprig/request-client";
import { eventEmitter, IMessageEvent } from "../src"

describe("stream eventEmitter", () => { 
    beforeEach(() => {
        mockClear();
    });

    test("on message received", async done => {
        mockResponse({ 
            status: 200,
            data: { foo: "bar" }
        });

        const result = await client.stream({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .thenUse(eventEmitter);

        const event = <IEvent<IMessageEvent>>result.data;
        event.on(e => {
            expect(e.data.foo).toBe("bar");
            done();
        });
    });
});