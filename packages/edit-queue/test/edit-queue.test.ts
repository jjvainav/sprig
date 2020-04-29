import "jest";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher } from "../src";

interface IMockEditData {
    readonly delay?: number;
    readonly error?: boolean;
    readonly response?: any;
    readonly value?: string;
}

interface IMockEditOperation extends IEditOperation {
    readonly type: "mock";
    readonly data: IMockEditData;
}

const dispatcher: IEditDispatcher<any> = edit => {
    const amount = (<IMockEditOperation>edit).data.delay;
    const error = (<IMockEditOperation>edit).data.error;
    const response = (<IMockEditOperation>edit).data.response;

    if (amount === undefined) {
        return error ? Promise.reject(new Error()) : Promise.resolve(response);
    }

    return delay(() => error ? Promise.reject(new Error()) : Promise.resolve(response), amount);
};
const observeDispatcher = <TResponse = void>(out: IEditOperation[], dispatcher: IEditDispatcher<TResponse>): IEditDispatcher<TResponse> => {
    return edit => dispatcher(edit).then(result => {
        out.push(edit);
        return result;
    });
};

function createEdit(data?: IMockEditData): IMockEditOperation {
    return { type: "mock", data: data || {} };
}

function delay<TReturn = void>(fn: () => TReturn, amount: number): Promise<TReturn> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                resolve(fn());
            }
            catch (error) {
                reject(error);
            }
        }, 
        amount);
    });
}

describe("edit queue", () => {
    test("publish edit to channel", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const edit = createEdit();
        
        const result = await publisher.publish(edit);

        expect(result.success).toBe(true);
        expect(result.channel).toBe(channel);
        expect(result.edit).toBe(edit);
        expect(result.error).toBeUndefined();
        expect(result.response).toBeUndefined();
    });

    test("publish edit to channel and observe", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher = channel.createPublisher();
        const edit = createEdit();
        
        const results: string[] = [];
        observer.on(() => results.push("observer"));

        await publisher.publish(edit).then(() => {
            results.push("publisher");
        });

        // ensure the observers are invoked prior to the publish promise resolving
        expect(results[0]).toBe("observer");
        expect(results[1]).toBe("publisher");
    });

    test("publish edit to channel with response", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const edit = createEdit({ response: "foo" });
        
        const result = await publisher.publish(edit);

        expect(result.success).toBe(true);
        expect(result.channel).toBe(channel);
        expect(result.edit).toBe(edit);
        expect(result.error).toBeUndefined();
        expect(result.response).toBe("foo");
    });

    test("publish edit to channel with error thrown from dispatcher", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const edit = createEdit({ error: true, response: "foo" });
        
        const result = await publisher.publish(edit);

        expect(result.success).toBe(false);
        expect(result.channel).toBe(channel);
        expect(result.edit).toBe(edit);
        expect(result.error).toBeDefined();
        expect(result.response).toBeUndefined();
    });

    test("publish multiple edits to channel and ensure dispatched in proper order", async () => {
        const out: IMockEditOperation[] = [];
        const queue = new EditQueue(observeDispatcher(out, dispatcher));
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        
        const result1 = await publisher.publish(createEdit({ delay: 0, value: "edit 1" }));
        const result2 = await publisher.publish(createEdit({ value: "edit 2" }));

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);

        expect(out).toHaveLength(2);
        expect(out[0].data.value).toBe("edit 1");
        expect(out[1].data.value).toBe("edit 2");
    });

    test("publish multiple edits to channel and ensure observed in proper order", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher = channel.createPublisher();

        const out: IMockEditOperation[] = [];
        observer.on(result => out.push(<IMockEditOperation>result.edit));
        
        const result1 = await publisher.publish(createEdit({ delay: 0, value: "edit 1" }));
        const result2 = await publisher.publish(createEdit({ value: "edit 2" }));

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);

        expect(out).toHaveLength(2);
        expect(out[0].data.value).toBe("edit 1");
        expect(out[1].data.value).toBe("edit 2");
    });

    test("publish multiple edits using different publishers for the same channel", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher1 = channel.createPublisher();
        const publisher2 = channel.createPublisher();

        const out: IMockEditOperation[] = [];
        observer.on(result => out.push(<IMockEditOperation>result.edit));
        
        const result1 = await publisher1.publish(createEdit({ delay: 0, value: "edit 1" }));
        const result2 = await publisher2.publish(createEdit({ value: "edit 2" }));

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);

        expect(out).toHaveLength(2);
        expect(out[0].data.value).toBe("edit 1");
        expect(out[1].data.value).toBe("edit 2");
    });

    test("publish multiple async edits to channel", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher = channel.createPublisher();
        
        const out: IMockEditOperation[] = [];
        observer.on(result => out.push(<IMockEditOperation>result.edit));

        await Promise.all([
            publisher.publish(createEdit({ delay: 10, value:  "Edit 1" })),
            publisher.publish(createEdit({ delay: 0, value: "Edit 2" })),
            publisher.publish(createEdit({ delay: 20, value:  "Edit 3" }))
        ]);

        expect(out[0].data.value).toBe("Edit 1");
        expect(out[1].data.value).toBe("Edit 2");
        expect(out[2].data.value).toBe("Edit 3");
    });

    test("publish edits using multiple channels", async () => {
        const queueOut: IMockEditOperation[] = [];
        const queue = new EditQueue(observeDispatcher(queueOut, dispatcher));
        const channel1 = queue.createChannel();
        const channel2 = queue.createChannel();

        const observer1 = channel1.createObserver();
        const observer2 = channel2.createObserver();

        const outChannel1: IMockEditOperation[] = [];
        observer1.on(result => outChannel1.push(<IMockEditOperation>result.edit));
        const outChannel2: IMockEditOperation[] = [];
        observer2.on(result => outChannel2.push(<IMockEditOperation>result.edit));

        await channel1.createPublisher().publish(createEdit({ delay: 0, value: "edit 1" }));
        await channel2.createPublisher().publish(createEdit({ delay: 0, value: "edit 2" }));

        expect(queueOut).toHaveLength(2);
        expect(queueOut[0].data.value).toBe("edit 1");
        expect(queueOut[1].data.value).toBe("edit 2");

        expect(outChannel1).toHaveLength(1);
        expect(outChannel1[0].data.value).toBe("edit 1");

        expect(outChannel2).toHaveLength(1);
        expect(outChannel2[0].data.value).toBe("edit 2");
    });
});