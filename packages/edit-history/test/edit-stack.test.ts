import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher } from "@sprig/edit-queue";
import { EditStack } from "../src";

interface IMockEdit extends IEditOperation {
    readonly type: "mock",
    readonly data: { 
        readonly name: string;
        readonly count: number;
    };
}

const mockDispatcher: IEditDispatcher = edit => {
    const reverse: IMockEdit = {
        type: "mock",
        data: { 
            name: (<IMockEdit>edit).data.name,
            count: (<IMockEdit>edit).data.count + 1
        }
    };

    return Promise.resolve(reverse);
};

function createEdit(name?: string): IMockEdit {
    return { 
        type: "mock", 
        data: { 
            name: name || "Edit",
            count: 1 
        } 
    };
}

describe("edit stack", () => {
    test("undo with single edit on stack", async () => {
        const queue = new EditQueue(mockDispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const stack = new EditStack();

        const edit = createEdit();

        const reverse: IMockEdit[] = [];
        observer.on(result => reverse.push(<IMockEdit>result.response));

        stack.push(edit);
        await stack.undo(channel.createPublisher());

        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(true);
        // the captured edit is expected to be the reverse edit
        expect(reverse).toHaveLength(1);
        expect((<IMockEdit>reverse[0]).data.count).toBe(2);
    });

    test("undo multiple edits", async () => {
        const queue = new EditQueue(mockDispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const stack = new EditStack();

        const edit1 = createEdit("Edit 1");
        const edit2 = createEdit("Edit 2");

        const edits: IEditOperation[] = [];
        observer.on(result => edits.push(result.edit));

        stack.push(edit1);
        stack.push(edit2);

        await stack.undo(channel.createPublisher());
        await stack.undo(channel.createPublisher());

        expect(edits).toHaveLength(2);

        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(true);
        expect((<IMockEdit>edits[0]).data.name).toBe("Edit 2");
        expect((<IMockEdit>edits[1]).data.name).toBe("Edit 1");
    });

    test("undo and then redo", async () => {
        const queue = new EditQueue(mockDispatcher);
        const channel = queue.createChannel();
        const observer = channel.createObserver();
        const stack = new EditStack();

        const edit = createEdit();

        const edits: IEditOperation[] = [];
        observer.on(result => edits.push(result.edit));

        stack.push(edit);
        await stack.undo(channel.createPublisher());
        await stack.redo(channel.createPublisher());

        expect(stack.canUndo()).toBe(true);
        expect(stack.canRedo()).toBe(false);
        // the dispatcher will increment the count property for the edit that was originally passed in
        expect(edits).toHaveLength(2);
        expect((<IMockEdit>edits[0]).data.count).toBe(1);
        expect((<IMockEdit>edits[1]).data.count).toBe(2);
    });

    test("current stack pointer", async () => {
        const queue = new EditQueue(mockDispatcher);
        const stack = new EditStack();

        expect(stack.current).toBeUndefined();

        stack.push(createEdit("1"));
        stack.push(createEdit("2"));
        stack.push(createEdit("3"));

        expect(stack.current!.edit.data.name).toBe("3");
        expect(stack.current!.checkpoint).toBe(3);

        // empty the stack

        await stack.undo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("2");
        expect(stack.current!.checkpoint).toBe(2);

        await stack.undo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("1");
        expect(stack.current!.checkpoint).toBe(1);

        await stack.undo(queue.createChannel().createPublisher());
        expect(stack.current).toBeUndefined();

        // redo all the edits

        await stack.redo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("1");
        expect(stack.current!.checkpoint).toBe(1);

        await stack.redo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("2");
        expect(stack.current!.checkpoint).toBe(2);

        await stack.redo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("3");
        expect(stack.current!.checkpoint).toBe(3);

        // perform an undo and then push a new item

        await stack.undo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("2");
        expect(stack.current!.checkpoint).toBe(2);

        stack.push(createEdit("4"));
        expect(stack.current!.edit.data.name).toBe("4");
        expect(stack.current!.checkpoint).toBe(4);

        // item and checkpoint 3 will be discarded - verify by performing an undo and checking the checkpoint
        await stack.undo(queue.createChannel().createPublisher());
        expect(stack.current!.edit.data.name).toBe("2");
        expect(stack.current!.checkpoint).toBe(2);
    });
});