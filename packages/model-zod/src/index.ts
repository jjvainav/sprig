import { IModel, IModelAttributes, IModelValidation } from "@sprig/model";
import * as zod from "zod";

type ZodErrorResult = { success: false, error: zod.ZodError };
type ZodSuccessResult<T> = { success: true, data: T };
type ZodParseResult<T> = ZodSuccessResult<T> | ZodErrorResult;

/** Creates model validation that uses a zod schema to validate it's attributes. */
export function createValidation<TAttributes extends IModelAttributes, TModel extends IModel<TAttributes>>(schema: zod.Schema<TAttributes>): IModelValidation<TAttributes, TModel> {
    return {
        validateAttribute: (model, attribute) => {
            const result: ZodParseResult<any> = isZodObject(schema)
                ? schema.pick(<{ [k in keyof TAttributes]?: true | undefined; }>{ [attribute]: true }).safeParse(model)
                : schema.safeParse(model);

            if (!isSuccess(result)) {
                const errorMessage = getErrorMessage(result.error, <string>attribute);
                if (errorMessage) {
                    model.setErrorMessage(attribute, getErrorMessage(result.error, <string>attribute));
                }
            }
        },
        validateModel: model => {
            const result = schema.safeParse(model);
            if (!isSuccess(result)) {
                setModelErrors(model, result.error);
            }
        }
    };
}

function getErrorMessage(error: zod.ZodError, attribute: string): string {
    const errors = error.formErrors.fieldErrors;
    return errors[attribute] && errors[attribute].length ? errors[attribute][0] : "";
}

function isSuccess<T>(result: ZodParseResult<T>): result is ZodSuccessResult<T> {
    return result.success;
}

function isZodObject(schema: any): schema is zod.ZodObject<any> {
    return (<zod.ZodObject<any>>schema).pick !== undefined;
}

function setModelErrors<TAttributes extends IModelAttributes>(model: IModel<TAttributes>, error: zod.ZodError): void {
    const errors = error.formErrors.fieldErrors;
    Object.keys(errors).forEach(key => model.setErrorMessage(<keyof TAttributes>key, getErrorMessage(error, key)));
}