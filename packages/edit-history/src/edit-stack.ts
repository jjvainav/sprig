import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannel } from "@sprig/edit-queue";

/** Represents an item on the edit stack. */
export interface IEditStackItem {
    readonly checkpoint: number;
    readonly edit: IEditOperation;
    readonly state?: any;
}

/** Defines the result of an undo/redo operation on the stack. */
export interface IEditStackResult {
    readonly success: boolean;
    readonly checkpoint: number;
    readonly edit: IEditOperation;
    readonly state?: any;
    readonly error?: any;
}

/** A simple undo/redo stack for edit operations. */
export class EditStack {
    private readonly undoStack: IEditStackItem[] = [];
    private readonly redoStack: IEditStackItem[] = [];

    private nextCheckpoint = 1;

    constructor(private readonly size = 50) {
    }

    /** Gets a pointer to the current location of the edit stack. */
    get current(): IEditStackItem | undefined {
        if (this.undoStack.length) {
            return this.undoStack[this.undoStack.length - 1];
        }

        return undefined;
    }

    remove(checkpoint: number): boolean {
        for (let i = 0; i < this.undoStack.length; i++) {
            if (this.undoStack[i].checkpoint === checkpoint) {
                this.undoStack.splice(i, 1);
                return true;
            }
        }

        for (let i = 0; i < this.redoStack.length; i++) {
            if (this.redoStack[i].checkpoint === checkpoint) {
                this.redoStack.splice(i, 1);
                return true;
            }
        }

        return false;
    }

    /** Pushes an edit onto the stack and optional state that will be associated with the current checkpoint of the stack. */
    push(edit: IEditOperation, state?: any): void {
        this.undoStack.push({ edit, state, checkpoint: this.nextCheckpoint++ });
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

    undo(channel: IEditChannel): Promise<IEditStackResult | undefined> {
        return this.handleUndoRedo(channel, this.undoStack, this.redoStack);
    }

    redo(channel: IEditChannel): Promise<IEditStackResult | undefined> {
        return this.handleUndoRedo(channel, this.redoStack, this.undoStack);
    }

    private handleUndoRedo(channel: IEditChannel, source: IEditStackItem[], target: IEditStackItem[]): Promise<IEditStackResult | undefined> {
        const item = source.pop();

        if (item) {
            return channel.createPublisher().publish(item.edit)
                .then(result => {
                    if (result.success && result.response) {
                        target.push({ edit: result.response, state: item.state, checkpoint: item.checkpoint });
                    }

                    return {
                        success: result.success,
                        checkpoint: item.checkpoint,
                        edit: result.edit,
                        state: item.state,
                        error: result.error
                    };
                });
        }

        return Promise.resolve(undefined);
    }
}