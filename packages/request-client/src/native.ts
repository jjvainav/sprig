export * from "./authorization";
export * from "./common";

import { buildClient } from "./client";
const client = buildClient(options => {
    if (typeof window === "undefined" || !window.EventSource) {
        throw new Error("EventSource not defined.");
    }

    return new window.EventSource(options.url);
});

export default client;