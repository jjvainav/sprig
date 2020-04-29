import "jest";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher } from "@sprig/edit-queue";
import { EditHistory } from "../src";

const dispatcher: IEditDispatcher<IEditOperation> = edit => new Promise(resolve => setTimeout(() => {
    resolve({ 
        type: edit.type === "mock.edit" ? "mock.reverse" : "mock.edit",
        data: {}
    });
}, 
0));

function createEdit(): IEditOperation {
    return { type: "mock.edit", data: {} };
}

describe("edit history", async () => {
    test("undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);
    
        const edits: IEditOperation[] = [];
        observer.on(result => edits.push(result.edit));

        await publisher.publish(createEdit());
        await history.undo();

        // 1 for the initial publish and 1 for the undo
        expect(edits).toHaveLength(2);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.reverse");
    });

    test("undo using different incoming and outgoing channels", async () => {
        const queue = new EditQueue(dispatcher);
        const incoming = queue.createChannel();
        const outgoing = queue.createChannel();
        const incomingObserver = incoming.createObserver();
        const outgoingObserver = outgoing.createObserver();
        const incomingPublisher = incoming.createPublisher();
        const history = new EditHistory(incoming, outgoing);

        const edits: IEditOperation[] = [];

        let incomingCount = 0;
        incomingObserver.on(result => {
            edits.push(result.edit);
            incomingCount++;
        });

        let outgoingCount = 0;
        outgoingObserver.on(result => {
            edits.push(result.edit);
            outgoingCount++
        });

        await incomingPublisher.publish(createEdit());
        await history.undo();

        // 1 for the initial publish and 1 for the undo
        expect(edits).toHaveLength(2);

        expect(incomingCount).toBe(1);
        expect(outgoingCount).toBe(1);
        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.reverse");
    });

    test("redo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);
    
        const edits: IEditOperation[] = [];
        observer.on(result => edits.push(result.edit));

        await publisher.publish(createEdit());

        // note: the history should queue undo/redo requests so an await is not necessary
        history.undo();
        await history.redo();

        // 1 for the initial publish, 1 for the undo, and 1 for the redo
        expect(edits).toHaveLength(3);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.reverse");
        expect(edits[2].type).toBe("mock.edit");
    });

    test("isUndo during undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);
    
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
        const history = new EditHistory(channel);
    
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
        const history = new EditHistory(channel);
    
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
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
        expect(history.canRedo()).toBeFalsy();
    });

    test("canUndo when history is empty", () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const history = new EditHistory(channel);
        expect(history.canUndo()).toBeFalsy();
    });

    test("canUndo after publishing edit", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());

        expect(history.canUndo()).toBeTruthy();
    });

    test("canUndo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());
        await history.undo();

        expect(history.canUndo()).toBeFalsy();
    });

    test("canRedo after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());
        await history.undo();

        expect(history.canRedo()).toBeTruthy();
    });

    test("canRedo when history is empty", () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const history = new EditHistory(channel);
        expect(history.canRedo()).toBeFalsy();
    });

    test("canRedo after publishing edit", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());
        await history.undo();
        await publisher.publish(createEdit());

        expect(history.canRedo()).toBeFalsy();
    });

    test("verify checkpoint and revision after undo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);

        await publisher.publish(createEdit());
        await publisher.publish(createEdit());
        
        history.undo();
        await history.undo();

        expect(history.revision).toBe(3);
        expect(history.checkpoint).toBe(1);
    });

    test("verify checkpoint and revision after redo", async () => {
        const queue = new EditQueue(dispatcher);
        const channel = queue.createChannel();
        const publisher = channel.createPublisher();
        const history = new EditHistory(channel);
        
        await publisher.publish(createEdit());
        await publisher.publish(createEdit());
        
        history.undo();
        history.undo();

        history.redo();
        await history.redo();

        expect(history.revision).toBe(3);
        expect(history.checkpoint).toBe(3);
    });
});