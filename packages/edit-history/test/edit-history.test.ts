import "jest";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditChannel, IEditDispatcher } from "@sprig/edit-queue";
import { EditHistory, IUndoRedoResult } from "../src";

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

function createReverseEdit(): IEditOperation {
    return { type: "mock.reverse", data: {} };
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await publisher.publish(createEdit());
        await history.undo();
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
        expect(history.canRedo()).toBeFalsy();
        expect(history.checkpoint).toBe(3);
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
        const publisher = channel.createPublisher();
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
    });

    test("canUndo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();

        expect(history.canUndo()).toBeFalsy();
    });

    test("canRedo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
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
        const publisher = channel.createPublisher();
        const history = createEditHistory(queue, channel);

        await publisher.publish(createEdit());
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canRedo()).toBeFalsy();
    });

    test("verify checkpoint during channel observer", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const history = new EditHistory(channel.createPublisher());

        const checkpoints: (number | undefined)[] = [];
        channel.createObserver().on(result => checkpoints.push(history.checkpoint));

        history.push(createReverseEdit());
        history.push(createReverseEdit());

        await history.undo();
        await history.undo();

        // the observer gets invoked after the undo operation
        expect(checkpoints[0]).toBe(1);
        expect(checkpoints[1]).toBeUndefined();
    });

    test("verify checkpoint during undo/redo events", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = createEditHistory(queue, channel);

        const checkpoints: (number | undefined)[] = [];
        const results: IUndoRedoResult[] = [];

        history.onRedo(result => results.push(result));
        history.onUndo(result => results.push(result));

        await publisher.publish(createEdit());
        checkpoints.push(history.checkpoint);

        await publisher.publish(createEdit());
        checkpoints.push(history.checkpoint);
        
        await history.undo();
        checkpoints.push(history.checkpoint);

        await history.undo();
        checkpoints.push(history.checkpoint);

        await history.redo();
        checkpoints.push(history.checkpoint);

        await history.redo();
        checkpoints.push(history.checkpoint);

        // the checkpoint is incremented after every publish
        expect(checkpoints[0]).toBe(1);
        expect(checkpoints[1]).toBe(2);
        // after the undo the checkpoint is expected to point backwards in the stack
        expect(checkpoints[2]).toBe(1);
        // the history is expected to be empty at this point so the checkpoint should be undefined
        expect(checkpoints[3]).toBeUndefined();
        // the checkpoint should be reset after each redo
        expect(checkpoints[4]).toBe(1);
        expect(checkpoints[5]).toBe(2);

        // the checkpoint associated with the edit that was undone
        expect(results[0].checkpoint).toBe(2);
        expect(results[1].checkpoint).toBe(1);
        // the checkpoint associated with the edit that was redone
        expect(results[2].checkpoint).toBe(1);
        expect(results[3].checkpoint).toBe(2);
    });
});