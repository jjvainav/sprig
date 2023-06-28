import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { IEditChannelPublisher } from "@sprig/edit-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { EditStack, IEditStackResult } from "./edit-stack";

export interface IEditHistory {
    /** A pointer into the current edit stack or undefined if the stack is empty. */
    readonly checkpoint: number | undefined;
    /** True when in the process of redoing an edit. */
    readonly isRedo: boolean;
    /** True when in the process of undoing an edit. */
    readonly isUndo: boolean;
    /** An event that is raised during a redo operation. */
    readonly onRedo: IEvent<IUndoRedoResult>;
    /** An event that is raised during an undo operation. */
    readonly onUndo: IEvent<IUndoRedoResult>;
    /** Determines if there are any edits that can be reverted. */
    canUndo(): boolean;
    /** Determines if there are any edits that can be re-published. */
    canRedo(): boolean;
    /** Manually pushes a reverse edit onto the stack. */
    push(reverse: IEditOperation, state?: any): boolean;
    /** Allows removing an edit from the history at the specified checkpoint without publishing. */
    remove(checkpoint: number): boolean;
    /** Reverts one level of edits. */
    undo(): Promise<IUndoRedoResult | undefined>;
    /** Republishes one level of edits. */
    redo(): Promise<IUndoRedoResult | undefined>;
}

export interface IUndoRedoResult extends IEditStackResult {
}

/** 
 * An edit history that supports pushing reverse edits that will later be published to a provided outgoing channel. 
 * This uses an async queue that allows queing undo/redo requests without the need to await for
 * a previous undo/redo to complete before invoking undo/redo again.
 */
export class EditHistory implements IEditHistory {
    private readonly redoEvent = new EventEmitter<IUndoRedoResult>();
    private readonly undoEvent = new EventEmitter<IUndoRedoResult>();
    private readonly editStack = new EditStack();
    private readonly queue = new AsyncQueue<IEditStackResult | undefined>();

    private _isUndo = false;
    private _isRedo = false;

    /** Creates a new EditHistory where edits being published are expected to provide a reverse edit as a response to being processed. */
    constructor(private readonly outgoing: IEditChannelPublisher<IEditOperation>) {
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

    get onRedo(): IEvent<IUndoRedoResult> {
        return this.redoEvent.event;
    }

    get onUndo(): IEvent<IUndoRedoResult> {
        return this.undoEvent.event;
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

    /** Manually pushes a reverse edit onto the stack. */
    push(reverse: IEditOperation, state?: any): boolean {
        if (!this._isUndo && !this._isRedo) {
            this.editStack.push(reverse, state);
            return true;
        }

        return false;
    }

    /** Allows removing an edit from the history at the specified checkpoint without publishing. */
    remove(checkpoint: number): boolean {
        return this.editStack.remove(checkpoint);
    }

    undo(): Promise<IUndoRedoResult | undefined> {
        return this.queueUndoRedo(
            this.canUndo.bind(this),
            () => this._isUndo = true,
            () => this._isUndo = false,
            this.editStack.undo.bind(this.editStack),
            this.undoEvent);
    }

    redo(): Promise<IUndoRedoResult | undefined> {
        return this.queueUndoRedo(
            this.canRedo.bind(this),
            () => this._isRedo = true,
            () => this._isRedo = false,
            this.editStack.redo.bind(this.editStack),
            this.redoEvent);
    }

    private queueUndoRedo(canUndoRedo: () => boolean, start: () => void, end: () => void, invoke: (publisher: IEditChannelPublisher<IEditOperation>) => Promise<IUndoRedoResult | undefined>, emitter: EventEmitter<IUndoRedoResult>): Promise<IUndoRedoResult | undefined> {
        return this.queue.push(() => {
            if (canUndoRedo()) {
                start();

                return invoke(this.outgoing).then(result => {
                    if (result) {
                        emitter.emit(result);
                    }

                    end();
                    return result;
                });
            }

            return Promise.resolve(undefined);
        });
    }
}