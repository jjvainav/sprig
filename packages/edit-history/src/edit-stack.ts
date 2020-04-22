import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannel } from "@sprig/edit-queue";

export interface IEditStackItem {
    readonly checkpoint: number;
    readonly edits: IEditOperation[];
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

    /**
     * Pushes a set of edit operations onto the stack representing a single transactional edit.
     * When performing an undo/redo the entire set of edits will be rolled back as one operation.
     * 
     * @param checkpoint A checkpoint value to associate with the edit.
     * @param edits A set of edits that were executed.
     */
    push(checkpoint: number, edits: IEditOperation[]): void {
        this.undoStack.push({ checkpoint, edits });
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

    undo(channel: IEditChannel): Promise<void> {
        return this.handleUndoRedo(channel, this.undoStack, this.redoStack);
    }

    redo(channel: IEditChannel): Promise<void> {
        return this.handleUndoRedo(channel, this.redoStack, this.undoStack);
    }

    private handleUndoRedo(channel: IEditChannel, source: IEditStackItem[], target: IEditStackItem[]): Promise<void> {
        const item = source.pop();

        if (item) {
            const reverse: IEditOperation[] = [];

            // when reverting changes for an undo/redo the edits should be published in reverse order
            for (let i = item.edits.length - 1; i >= 0; i--) {
                reverse.push(item.edits[i]);
            }

            return channel.publish(reverse).then(result => {
                if (result.isCommitted) {
                    target.push({ checkpoint: item.checkpoint, edits: result.reverse });
                }
            });
        }

        return Promise.resolve();
    }
}