import * as yup from "yup";
import { IResponse, RequestError, RequestErrorCode } from "@sprig/request-client";

/** Response handler that accepts a yup schema to extract and validate response data. */
export function validate<T>(response: IResponse, schema: yup.Schema<T>, options?: yup.ValidateOptions): Promise<T> {
    return new Promise((resolve, reject) => {
        options = options || { stripUnknown: true };

        schema.validate(response.data, options)
            .then(resolve)
            .catch((err: yup.ValidationError) => 
                reject(new RequestError({
                    code: RequestErrorCode.invalidResponse,
                    message: err.errors.toString(),
                    request: response.request,
                    response
                })));
    });
}