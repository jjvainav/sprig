import "jest";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditChannel, IEditDispatcher } from "@sprig/edit-queue";
import { EditHistory } from "../src";

const dispatcher: IEditDispatcher = edit => new Promise(resolve => setTimeout(() => {
    resolve({ 
        type: edit.type === "mock.edit" ? "mock.reverse" : "mock.edit",
        data: {}
    });
}, 
0));

function createEdit(): IEditOperation {
    return { type: "mock.edit", data: {} };
}

function createEditHistory(queue: EditQueue, channelToMonitor: IEditChannel): EditHistory {
    const history = new EditHistory(queue.createChannel().createPublisher());
    channelToMonitor.createObserver().on(result => {
        if (result.success && result.response) {
            history.push(result.response);
        }
    });

    return history;
}

describe("edit history", () => {
    test("undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());
        const result = await history.undo();

        expect(result).toBeDefined();
        expect(result!.success).toBe(true);

        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);
    });

    test("redo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());
        await history.undo();
        const result = await history.redo();

        expect(result).toBeDefined();
        expect(result!.success).toBe(true);

        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
    });

    test("undo and then redo without waiting for undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());

        // note: the history should queue undo/redo requests so an await is not necessary
        history.undo();
        const result = await history.redo();

        expect(result).toBeDefined();
        expect(result!.success).toBe(true);

        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);
    });

    test("isUndo during undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());

        const promise = history.undo();
        const isUndo = history.isUndo;

        await promise;

        expect(isUndo).toBeTruthy();
        expect(history.isUndo).toBeFalsy();
    });

    test("isUndo during multiple undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());
        await publisher.publish(createEdit());

        const result: boolean[] = [];
        const promise1 = history.undo();
        const promise2 = history.undo();

        result.push(history.isUndo);
        await promise1;
        result.push(history.isUndo);
        await promise2;

        expect(result[0]).toBeTruthy();
        expect(result[1]).toBeTruthy();
        expect(history.isUndo).toBeFalsy();
    });

    test("isRedo during redo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);
    
        await publisher.publish(createEdit());
        await history.undo();

        const promise = history.redo();
        const isRedo = history.isRedo;

        await promise;

        expect(isRedo).toBeTruthy();
        expect(history.isRedo).toBeFalsy();
    });

    test("publish new edit after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
        expect(history.canRedo()).toBeFalsy();
    });

    test("canUndo when history is empty", () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const history = createEditHistory(queue, channel);
        expect(history.canUndo()).toBeFalsy();
    });

    test("canUndo after publishing edit", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
    });

    test("canUndo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();

        expect(history.canUndo()).toBeFalsy();
    });

    test("canRedo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();

        expect(history.canRedo()).toBeTruthy();
    });

    test("canRedo when history is empty", () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const history = createEditHistory(queue, channel);
        expect(history.canRedo()).toBeFalsy();
    });

    test("canRedo after publishing edit", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher({ waitOnObservers: true });
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canRedo()).toBeFalsy();
    });
});