export * from "./authorization";
export * from "./common";

import { createClient } from "./client";
const client = createClient(options => {
    if (typeof window === "undefined" || !window.EventSource) {
        throw new Error("EventSource not defined.");
    }

    return new window.EventSource(options.url);
});

export default client;