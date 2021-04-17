import * as zod from "zod";
// in order for the mock to work it must be imported before request-client
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import client, { RequestErrorCode } from "@sprig/request-client";
import { validate } from "../src";

interface IFoo {
    foo: string;
    foobar: {
        bar: string;
    }
}

const fooSchema: zod.ZodSchema<IFoo> = zod.object({
    foo: zod.string(),
    foobar: zod.object({
        bar: zod.string()
    })
});

describe("validate", () => {
    beforeEach(() => {
        mockClear();
    });

    test("with valid response data", async () => {
        mockResponse({ 
            status: 200,
            data: {
                foo: "foo",
                foobar: { bar: "bar" }
            }
        });

        // result should be a typed IFoo object
        const result = await client.request({
            method: "GET",
            url: "http://localhost"
        })
        .invoke()
        .then(response => validate(response, fooSchema));

        expect(result.foo).toBe("foo");
        expect(result.foobar.bar).toBe("bar");
    });    

    test("with invalid response data that fails", async () => {
        mockResponse({ 
            status: 200,
            data: {
                foo: "foo",
                bar: "bar"
            }
        });

        try {
            await client.request({
                method: "GET",
                url: "http://localhost"
            })
            .invoke()
            .then(response => validate(response, fooSchema));

            fail();
        }
        catch(err) {
            expect(err.code).toBe(RequestErrorCode.invalidResponse);
        }
    });
});