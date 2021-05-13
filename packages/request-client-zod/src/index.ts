import * as zod from "zod";
import { IResponse, RequestError, RequestErrorCode } from "@sprig/request-client";

type ParseSuccess<T> = { success: true, data: T };
type ParseError = { success: false, error: zod.ZodError };

function isSuccess<T>(result: ParseSuccess<T> | ParseError): result is ParseSuccess<T> {
    return result.success;
}

function getErrorMessage(error: zod.ZodError): string {
    const messages: string[] = [];
    const errors = error.flatten();

    for (const key of Object.keys(errors.fieldErrors)) {
        for (const err of errors.fieldErrors[key]) {
            messages.push(`${key}: ${toLower(err)}`);
        }
    }

    messages.push(...errors.formErrors);

    return messages.join("\n");
}

function toLower(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

/** Response handler that accepts a schema to extract and validate response data. */
export function validate<T>(response: IResponse, schema: zod.ZodSchema<T>): T {
    const result = schema.safeParse(response.data);
    if (isSuccess(result)) {
        return result.data;
    }

    throw new RequestError({
        code: RequestErrorCode.invalidResponse,
        message: getErrorMessage(result.error),
        request: response.request,
        response
    });
}