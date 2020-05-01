import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannel } from "@sprig/edit-queue";
import { EditStack, IEditStackResult } from "./edit-stack";

export interface IEditHistory {
    /** A pointer into the current edit stack or undefined if the stack is empty. */
    readonly checkpoint: number | undefined;
    /** Determines if there are any edits that can be reverted. */
    canUndo(): boolean;
    /** Determines if there are any edits that can be re-published. */
    canRedo(): boolean;
    /** Reverts one level of edits. */
    undo(): Promise<IEditStackResult | undefined>;
    /** Republishes one level of edits. */
    redo(): Promise<IEditStackResult | undefined>;
}

/** 
 * An edit history that supports pushing reverse edits that will later be published to a provided outgoing channel. 
 * This uses an async queue that allows queing undo/redo requests without the need to await for
 * a previous undo/redo to complete before invoking undo/redo again.
 */
export class EditHistory implements IEditHistory {
    private readonly editStack = new EditStack();
    private readonly queue = new AsyncQueue<IEditStackResult | undefined>();

    private _isUndo = false;
    private _isRedo = false;

    constructor(private readonly outgoing: IEditChannel) {
    }

    get checkpoint(): number | undefined {
        const current = this.editStack.current;
        return current && current.checkpoint;
    }

    get isUndo(): boolean {
        return this._isUndo;
    }

    get isRedo(): boolean {
        return this._isRedo;
    }

    canUndo(): boolean {
        return !this._isUndo &&
            !this._isRedo &&
            this.editStack.canUndo();
    }

    canRedo(): boolean {
        return !this._isUndo &&
            !this._isRedo &&
            this.editStack.canRedo();
    }

    /** Pushes a reverse edit onto the stack. */
    push(reverse: IEditOperation, state?: any): boolean {
        if (!this._isUndo && !this._isRedo) {
            this.editStack.push(reverse, state);
            return true;
        }

        return false;
    }

    /** Removes the top item from the edit history without publishing. */
    pop(): void {
        this.editStack.pop();
    }

    undo(): Promise<IEditStackResult | undefined> {
        return this.queueUndoRedo(
            this.canUndo.bind(this),
            () => this._isUndo = true,
            () => this._isUndo = false,
            this.editStack.undo.bind(this.editStack));
    }

    redo(): Promise<IEditStackResult | undefined> {
        return this.queueUndoRedo(
            this.canRedo.bind(this),
            () => this._isRedo = true,
            () => this._isRedo = false,
            this.editStack.redo.bind(this.editStack));
    }

    private queueUndoRedo(canUndoRedo: () => boolean, start: () => void, end: () => void, invoke: (channel: IEditChannel) => Promise<IEditStackResult | undefined>): Promise<IEditStackResult | undefined> {
        return this.queue.push(() => {
            if (canUndoRedo()) {
                start();

                return invoke(this.outgoing).then(result => {
                    end();
                    return result;
                });
            }

            return Promise.resolve(undefined);
        });
    }
}