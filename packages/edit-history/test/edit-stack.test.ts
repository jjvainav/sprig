import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher } from "@sprig/edit-queue";
import { EditStack } from "../src";

const mockDispatcher: IEditDispatcher = edit => Promise.resolve([edit]);

describe("edit stack", () => {
    test("undo", async () => {
        const channel = new EditQueue(mockDispatcher).createChannel();
        const stack = new EditStack();

        const edit1 = { type: "mock" };
        const edit2 = { type: "mock" };

        const edits: IEditOperation[] = [];

        channel.onTransactionEnded(event => edits.push(...event.result.edits));

        stack.push(1, [edit1, edit2]);

        // the reverse edits will get published against the provided channel
        await stack.undo(channel);

        expect(edits).toHaveLength(2);

        // the reverse edits should be executed in reverse order
        expect(edits[0]).toBe(edit2);
        expect(edits[1]).toBe(edit1);
    });

    test("redo", async () => {
        const service = new EditQueue(mockDispatcher);
        const channel = service.createChannel();
        const stack = new EditStack();

        const edit1 = { type: "mock.edit1" };
        const edit2 = { type: "mock.edit2" };

        const edits: IEditOperation[] = [];

        channel.onTransactionEnded(event => edits.push(...event.result.edits));

        stack.push(1, [edit1, edit2]);

        await stack.undo(service.createChannel());
        await stack.redo(channel);

        expect(edits).toHaveLength(2);

        expect(edits[0]).toBe(edit1);
        expect(edits[1]).toBe(edit2);
    });

    test("current stack pointer", async () => {
        const service = new EditQueue(mockDispatcher);
        const stack = new EditStack();

        expect(stack.current).toBeUndefined();

        stack.push(1, [{ type: "mock" }]);
        stack.push(2, [{ type: "mock" }]);
        stack.push(3, [{ type: "mock" }]);

        expect(stack.current!.checkpoint).toBe(3);

        await stack.undo(service.createChannel());

        expect(stack.current!.checkpoint).toBe(2);

        await stack.undo(service.createChannel());

        expect(stack.current!.checkpoint).toBe(1);

        await stack.undo(service.createChannel());

        expect(stack.current).toBeUndefined();

        await stack.redo(service.createChannel());
        await stack.redo(service.createChannel());
        await stack.redo(service.createChannel());

        expect(stack.current!.checkpoint).toBe(3);
    });
});