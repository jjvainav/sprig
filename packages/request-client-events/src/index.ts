import { EventEmitter } from "@sprig/event-emitter";
import { IResponseInterceptor } from "@sprig/request-client";
import EventSource from "eventsource";

/** Defines a message event received from the event stream. */
export interface IMessageEvent {
    readonly data: any;
}

function isEventSource(data: any): data is EventSource {
    // the onmessage should always be defined and defaults to null if no handlers are registered with the EventSource
    return (<EventSource>data).onmessage !== undefined;
}

/** 
 * An interceptor that will wrap a stream's EventSource as an EventEmitter. 
 * A few things to note: by default the event source will pass on JSON as a string, the
 * EventEmitter will attempt to parse the JSON and pass it as an object. Also, the
 * EventSource will automatically be closed when all event listeners have been removed 
 * from the EventEmitter.
 */
export const eventEmitter: IResponseInterceptor = context => {
    if (!context.response || !isEventSource(context.response.data)) {
        return context.next();
    }

    context.next({
        ...context,
        response: {
            ...context.response,
            data: new ServerSentEventEmitter(context.response.data).event
        }
    });
};

class ServerSentEventEmitter extends EventEmitter<IMessageEvent> {
    constructor(private readonly eventSource: EventSource) {
        super("message-received");
        this.eventSource.onmessage = e => this.handleMessageData(e.data);
    }

    protected callbackUnregistered(): void {
        if (!this.count) {
            this.eventSource.close();
        }
    }

    private handleMessageData(data: any): void {
        if (typeof data === "string") {
            try {
                this.emit({ data: JSON.parse(data) });
                return;
            }
            catch {
            }
        }

        this.emit({ data });
    }
}