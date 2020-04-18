import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher } from "@sprig/edit-queue";
import { EditHistory } from "../src";

const mockDispatcher: (out?: IEditOperation[]) => IEditDispatcher = out => edit => {
    if (out) {
        out.push(edit);
    }

    return Promise.resolve([{ 
        type: edit.type === "mock.edit" ? "mock.reverse" : "mock.edit" 
    }]);
};

describe("edit history", async () => {
    test("undo", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);
    
        await channel.publish({ type: "mock.edit" });
        await history.undo();

        // 1 for the initial publish and 1 for the undo
        expect(edits).toHaveLength(2);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.reverse");
    });

    test("undo multiple edits as a batch", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);

        const transaction = channel.beginTransaction();
        const completed = new Promise(resolve => transaction.onCompleted(() => resolve()));

        transaction.publish({ type: "mock.edit" });
        transaction.publish({ type: "mock.edit" });
        transaction.publish({ type: "mock.edit" });
        transaction.end();

        await completed;
        await history.undo();

        expect(edits).toHaveLength(6);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.edit");
        expect(edits[2].type).toBe("mock.edit");
        expect(edits[3].type).toBe("mock.reverse");
        expect(edits[4].type).toBe("mock.reverse");
        expect(edits[5].type).toBe("mock.reverse");
    });

    test("undo multiple edits as a batch using transaction scope", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);

        await channel.publish(async transaction => {
            await transaction.publish({ type: "mock.edit" });
            await transaction.publish({ type: "mock.edit" });
            await transaction.publish({ type: "mock.edit" });
        });

        await history.undo();

        expect(edits).toHaveLength(6);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.edit");
        expect(edits[2].type).toBe("mock.edit");
        expect(edits[3].type).toBe("mock.reverse");
        expect(edits[4].type).toBe("mock.reverse");
        expect(edits[5].type).toBe("mock.reverse");
    });

    test("redo", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });

        // note: the history should queue undo/redo requests so an await is not necessary
        history.undo();
        await history.redo();

        // 1 for the initial publish, 1 for the undo, and 1 for the redo
        expect(edits).toHaveLength(3);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.reverse");
        expect(edits[2].type).toBe("mock.edit");
    });

    test("redo multiple edits as a batch", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);

        const transaction = channel.beginTransaction();
        const completed = new Promise(resolve => transaction.onCompleted(() => resolve()));

        transaction.publish({ type: "mock.edit" });
        transaction.publish({ type: "mock.edit" });
        transaction.publish({ type: "mock.edit" });
        transaction.end();

        await completed;

        // note: the history should queue undo/redo requests so an await is not necessary
        history.undo();
        await history.redo();

        expect(edits).toHaveLength(9);

        expect(edits[0].type).toBe("mock.edit");
        expect(edits[1].type).toBe("mock.edit");
        expect(edits[2].type).toBe("mock.edit");
        expect(edits[3].type).toBe("mock.reverse");
        expect(edits[4].type).toBe("mock.reverse");
        expect(edits[5].type).toBe("mock.reverse");
        expect(edits[6].type).toBe("mock.edit");
        expect(edits[7].type).toBe("mock.edit");
        expect(edits[8].type).toBe("mock.edit");
    });

    test("isUndo during undo", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);
    
        await channel.publish({ type: "mock.edit" });

        const promise = history.undo();
        const isUndo = history.isUndo;

        await promise;

        expect(isUndo).toBeTruthy();
        expect(history.isUndo).toBeFalsy();
    });

    test("isUndo during multiple undo", async () => {
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);
    
        await channel.publish({ type: "mock.edit" });
        await channel.publish({ type: "mock.edit" });

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
        const edits: IEditOperation[] = [];
        const channel = new EditQueue(mockDispatcher(edits)).createChannel();
        const history = new EditHistory(channel);
    
        await channel.publish({ type: "mock.edit" });
        await history.undo();

        const promise = history.redo();
        const isRedo = history.isRedo;

        await promise;

        expect(isRedo).toBeTruthy();
        expect(history.isRedo).toBeFalsy();
    });

    test("publish new edit after undo", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await history.undo();
        await channel.publish({ type: "mock.edit" });

        expect(history.canUndo()).toBeTruthy();
        expect(history.canRedo()).toBeFalsy();
    });

    test("canUndo when history is empty", () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);
        expect(history.canUndo()).toBeFalsy();
    });

    test("canUndo when transaction open", () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        const transaction = channel.beginTransaction();
        transaction.publish({ type: "mock.edit" });

        expect(history.canUndo()).toBeFalsy();
    });

    test("canUndo after publishing edit", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });

        expect(history.canUndo()).toBeTruthy();
    });

    test("canUndo after undo", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await history.undo();

        expect(history.canUndo()).toBeFalsy();
    });

    test("canRedo after undo", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await history.undo();

        expect(history.canRedo()).toBeTruthy();
    });

    test("canRedo when history is empty", () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);
        expect(history.canRedo()).toBeFalsy();
    });

    test("canRedo when transaction open", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await history.undo();

        channel.beginTransaction();

        expect(history.canRedo()).toBeFalsy();
    });

    test("canRedo after publishing edit", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await history.undo();
        await channel.publish({ type: "mock.edit" });

        expect(history.canRedo()).toBeFalsy();
    });

    test("verify checkpoint and revision after undo", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);

        await channel.publish({ type: "mock.edit" });
        await channel.publish({ type: "mock.edit" });
        
        history.undo();
        await history.undo();

        expect(history.revision).toBe(3);
        expect(history.checkpoint).toBe(1);
    });

    test("verify checkpoint and revision after redo", async () => {
        const channel = new EditQueue(mockDispatcher()).createChannel();
        const history = new EditHistory(channel);
        
        await channel.publish({ type: "mock.edit" });
        await channel.publish({ type: "mock.edit" });
        
        history.undo();
        history.undo();

        history.redo();
        await history.redo();

        expect(history.revision).toBe(3);
        expect(history.checkpoint).toBe(3);
    });
});