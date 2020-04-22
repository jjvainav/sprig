//import { Disposable, ProcessQueue } from "@lib/common";
import { AsyncQueue } from "@sprig/async-queue";
import { IEditChannel, IEditTransactionEvent } from "@sprig/edit-queue";
import { IEventListener } from "@sprig/event-emitter";
import { EditStack } from "./edit-stack";

export interface IEditHistory {
    /** 
     * Gets the checkpoint representing a pointer to the current location in the undo/redo stack.
     * Whenever an edit occurs a checkpoint is assigned as the revision number for the edit and added 
     * to the stack. Unlike revision, this can move forward or backward and is set based on where in 
     * the undo/redo stack the state is in. When the data is not edited via undo/redo the checkpoint 
     * will be the same as the revision number.
     */
    readonly checkpoint: number;

    /** Gets the current revision for the history. */
    readonly revision: number;

    /**
     * Determines if there are any edits that can be reverted.
     */
    canUndo(): boolean;

    /**
     * Determines if there are any edits that can be re-published.
     */
    canRedo(): boolean;

    /**
     * Reverts one level of edits.
     */
    undo(): Promise<void>;

    /**
     * Republishes one level of edits.
     */
    redo(): Promise<void>;
}

const initialCheckpoint = 1;

/** 
 * An edit history that captures published edits for a channel and adds them to an undo/redo stack. 
 * This uses an async queue that allows queing undo/redo requests without the need to await for
 * a previous undo/redo to complete before invoking undo/redo again.
 */
export class EditHistory implements IEditHistory {
    private readonly listeners: IEventListener[] = [];
    private readonly editStack = new EditStack();
    private readonly queue = new AsyncQueue();

    private openTransactionCount = 0;

    private _isUndo = false;
    private _isRedo = false;

    private _checkpoint = initialCheckpoint;
    private _revision = initialCheckpoint;

    constructor(private readonly channel: IEditChannel) {
        this.listeners.push(this.channel.onTransactionStarted(() => this.openTransactionCount++));
        this.listeners.push(this.channel.onTransactionEnded(this.onTransactionEnded.bind(this)));
    }

    get isUndo(): boolean {
        return this._isUndo;
    }

    get isRedo(): boolean {
        return this._isRedo;
    }

    get checkpoint(): number {
        return this._checkpoint;
    }

    get revision(): number {
        return this._revision;
    }

    dispose(): void {
        this.listeners.forEach(listener => listener.remove());
        this.listeners.length = 0;
    }

    canUndo(): boolean {
        return !this.openTransactionCount &&
            !this._isUndo &&
            !this._isRedo &&
            this.editStack.canUndo();
    }

    canRedo(): boolean {
        return !this.openTransactionCount &&
            !this._isUndo &&
            !this._isRedo &&
            this.editStack.canRedo();
    }

    /** Removes the top item from the edit history without publishing. */
    pop(): void {
        this.editStack.pop();
    }

    undo(): Promise<void> {
        return this.queueUndoRedo(
            this.canUndo.bind(this),
            () => this._isUndo = true,
            () => this._isUndo = false,
            this.editStack.undo.bind(this.editStack));
    }

    redo(): Promise<void> {
        return this.queueUndoRedo(
            this.canRedo.bind(this),
            () => this._isRedo = true,
            () => this._isRedo = false,
            this.editStack.redo.bind(this.editStack));
    }

    private queueUndoRedo(canUndoRedo: () => boolean, start: () => void, end: () => void, invoke: (channel: IEditChannel) => Promise<void>): Promise<void> {
        return this.queue.push(() => {
            if (canUndoRedo()) {
                start();

                return invoke(this.channel).then(() => {
                    // update the checkpoint number to the current pointer in the stack
                    this._checkpoint = this.editStack.current ? this.editStack.current.checkpoint : initialCheckpoint;
                    end();
                });
            }

            return Promise.resolve();
        });
    }

    private onTransactionEnded(event: IEditTransactionEvent): void {
        if (!this._isUndo && !this._isRedo) {
            // make sure the transaction was successful and 'reverse' edits are included
            if (event.result.isCommitted && event.result.reverse.length > 0) {
                this._revision++;
                this._checkpoint = this._revision;
                this.editStack.push(this._checkpoint, event.result.reverse);
            }
        }

        this.openTransactionCount--;
    }
}