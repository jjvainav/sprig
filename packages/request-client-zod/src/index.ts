import * as zod from "zod";
import { IResponse, RequestError, RequestErrorCode } from "@sprig/request-client";

type ParseSuccess<T> = { success: true, data: T };
type ParseError = { success: false, error: zod.ZodError };

function isSuccess<T>(result: ParseSuccess<T> | ParseError): result is ParseSuccess<T> {
    return result.success;
}

/** Response handler that accepts a schema to extract and validate response data. */
export function validate<T>(response: IResponse, schema: zod.ZodSchema<T>): T {
    const result = schema.safeParse(response.data);
    if (isSuccess(result)) {
        return result.data;
    }

    throw new RequestError({
        code: RequestErrorCode.invalidResponse,
        message: result.error.message,
        request: response.request
    });
}