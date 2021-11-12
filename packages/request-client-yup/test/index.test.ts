import * as yup from "yup";
// in order for the mock to work it must be imported first
import { mockClear, mockResponse } from "@sprig/request-client-mock";
import client, { RequestErrorCode } from "@sprig/request-client/dist/polyfill";
import { validate } from "../src";

interface IFoo {
    foo: string;
    foobar: {
        bar: string;
    }
}

const fooSchema = yup.object<IFoo>({
    foo: yup.string().required(),
    foobar: yup.object({
        bar: yup.string().required()
    })
    .required()
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
        const result: IFoo = await client.request({
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