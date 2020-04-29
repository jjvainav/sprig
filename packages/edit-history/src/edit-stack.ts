import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannel, IEditDispatchResult } from "@sprig/edit-queue";

export interface IEditStackItem {
    readonly checkpoint: number;
    readonly edit: IEditOperation;
}

/** A simple undo/redo stack for edit operations. */
export class EditStack {
    private readonly undoStack: IEditStackItem[] = [];
    private readonly redoStack: IEditStackItem[] = [];

    constructor(private readonly size = 50) {
    }

    /** Gets a pointer to the current location of the edit stack. */
    get current(): IEditStackItem | undefined {
        if (this.undoStack.length) {
            return this.undoStack[this.undoStack.length - 1];
        }

        return undefined;
    }

    /** Removes the top item from the stack without publishing. */
    pop(): IEditStackItem | undefined {
        return this.undoStack.pop();
    }

    /** Pushes an edit onto the stack. */
    push(checkpoint: number, edit: IEditOperation): void {
        this.undoStack.push({ checkpoint, edit });
        this.redoStack.length = 0;
        
        while (this.undoStack.length > this.size) {
            this.undoStack.shift();
        }
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    undo(channel: IEditChannel<IEditOperation>): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        return this.handleUndoRedo(channel, this.undoStack, this.redoStack);
    }

    redo(channel: IEditChannel<IEditOperation>): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        return this.handleUndoRedo(channel, this.redoStack, this.undoStack);
    }

    private handleUndoRedo(channel: IEditChannel<IEditOperation>, source: IEditStackItem[], target: IEditStackItem[]): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        const item = source.pop();

        if (item) {
            return channel.createPublisher().publish(item.edit)
                .then(result => {
                    if (result.success && result.response) {
                        target.push({ checkpoint: item.checkpoint, edit: result.response });
                    }

                    return result;
                });
        }

        return Promise.resolve(undefined);
    }
}