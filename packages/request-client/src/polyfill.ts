export * from "./authorization";
export * from "./common";

import EventSourcePolyfill from "eventsource";
import { createClient } from "./client";
const client = createClient(options => {
    // by default use the EventSource polyfill as it provides additional support not available in the browser's native EventSource:
    // 1) support for HTTP headers -- useful when using authorization tokens
    // 2) the EventSource polyfill includes http status codes when failing to connected -- useful when determining the reason for a failure
    // 3) has dependencies on node core modules so node js polyfills are required when using on the browser
    // 4) the polyfill will not show events in the browser networking panel: https://github.com/EventSource/eventsource/issues/94
    return <EventSource>(new EventSourcePolyfill(options.url, { headers: options.headers }));
});

export default client;