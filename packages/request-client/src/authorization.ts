import { IRequestInterceptor } from "./client";

// btoa is not available in Nodejs
if (typeof btoa === "undefined") {
    (<any>global).btoa = function (str: string): string {
        return Buffer.from(str, "binary").toString("base64");
    };
}

/** A request interceptor that will inject a Basic Authorization header into a request. */
export function basicAuthentication(username: string, password: string): IRequestInterceptor {
    return context => {
        context.next({
            ...context,
            request: context.request.withHeader("Authorization", `Basic ${btoa(username + ":" + password)}`)
        });
    };
}

/** A request interceptor that will inject a Bearer Authorization header into a request. */
export function bearerAuthentication(token: string): IRequestInterceptor {
    return context => {
        context.next({
            ...context,
            request: context.request.withHeader("Authorization", `Bearer ${token}`)
        });
    };
}