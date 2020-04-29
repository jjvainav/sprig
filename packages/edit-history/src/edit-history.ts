import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannel, IEditDispatchResult } from "@sprig/edit-queue";
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
    /** Determines if there are any edits that can be reverted. */
    canUndo(): boolean;
    /** Determines if there are any edits that can be re-published. */
    canRedo(): boolean;
    /** Disposes/destroys the edit history and detaches itself from listening for edits. */
    dispose(): void;
    /** Reverts one level of edits. */
    undo(): Promise<IEditDispatchResult<IEditOperation> | undefined>;
    /** Republishes one level of edits. */
    redo(): Promise<IEditDispatchResult<IEditOperation> | undefined>;
}

const initialCheckpoint = 1;

/** 
 * An edit history captures edits dispatched from a channel and adds them to an undo/redo stack. 
 * This uses an async queue that allows queing undo/redo requests without the need to await for
 * a previous undo/redo to complete before invoking undo/redo again.
 * 
 * Note: the dispatcher used to dispatch edits for the channel is expected to return reverse edits.
 */
export class EditHistory implements IEditHistory {
    private readonly listeners: IEventListener[] = [];
    private readonly editStack = new EditStack();
    private readonly queue = new AsyncQueue<IEditDispatchResult<IEditOperation> | undefined>();
    private readonly _in: IEditChannel<IEditOperation>;
    private readonly _out: IEditChannel<IEditOperation>;

    private _isUndo = false;
    private _isRedo = false;

    private _checkpoint = initialCheckpoint;
    private _revision = initialCheckpoint;

    constructor(incoming: IEditChannel<IEditOperation>, outgoing?: IEditChannel<IEditOperation>) {
        this._in = incoming;
        this._out = outgoing || incoming;

        this.listeners.push(this._in.createObserver()
            .filter(result => result.success && result.response !== undefined)
            .on(this.onEditDispatched.bind(this)));
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
        return !this._isUndo &&
            !this._isRedo &&
            this.editStack.canUndo();
    }

    canRedo(): boolean {
        return !this._isUndo &&
            !this._isRedo &&
            this.editStack.canRedo();
    }

    /** Removes the top item from the edit history without publishing. */
    pop(): void {
        this.editStack.pop();
    }

    undo(): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        return this.queueUndoRedo(
            this.canUndo.bind(this),
            () => this._isUndo = true,
            () => this._isUndo = false,
            this.editStack.undo.bind(this.editStack));
    }

    redo(): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        return this.queueUndoRedo(
            this.canRedo.bind(this),
            () => this._isRedo = true,
            () => this._isRedo = false,
            this.editStack.redo.bind(this.editStack));
    }

    private queueUndoRedo(canUndoRedo: () => boolean, start: () => void, end: () => void, invoke: (channel: IEditChannel<IEditOperation>) => Promise<IEditDispatchResult<IEditOperation> | undefined>): Promise<IEditDispatchResult<IEditOperation> | undefined> {
        return this.queue.push(() => {
            if (canUndoRedo()) {
                start();

                return invoke(this._out).then(result => {
                    // update the checkpoint number to the current pointer in the stack
                    this._checkpoint = this.editStack.current ? this.editStack.current.checkpoint : initialCheckpoint;
                    end();
                    return result;
                });
            }

            return Promise.resolve(undefined);
        });
    }

    private onEditDispatched(result: IEditDispatchResult<IEditOperation>): void {
        if (!this._isUndo && !this._isRedo) {
            this._revision++;
            this._checkpoint = this._revision;
            this.editStack.push(this._checkpoint, result.response!);
        }
    }
}