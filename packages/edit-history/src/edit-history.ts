import { AsyncQueue } from "@sprig/async-queue";
import { IEditChannel, IEditDispatchResult } from "@sprig/edit-queue";
import { IEventListener } from "@sprig/event-emitter";
import { EditStack } from "./edit-stack";

export interface IEditHistory {
    /** Determines if there are any edits that can be reverted. */
    canUndo(): boolean;
    /** Determines if there are any edits that can be re-published. */
    canRedo(): boolean;
    /** Disposes/destroys the edit history and detaches itself from listening for edits. */
    dispose(): void;
    /** Reverts one level of edits. */
    undo(): Promise<IEditDispatchResult | undefined>;
    /** Republishes one level of edits. */
    redo(): Promise<IEditDispatchResult | undefined>;
}

/** 
 * An edit history captures edits from a channel and adds them to an undo/redo stack. 
 * This uses an async queue that allows queing undo/redo requests without the need to await for
 * a previous undo/redo to complete before invoking undo/redo again.
 * 
 * Note: the incoming channel is expected to be reverse edits that get added to the stack and the 
 * outgoing channel is responsible for executing the edits from the undo/redo stack.
 */
export class EditHistory implements IEditHistory {
    private readonly listeners: IEventListener[] = [];
    private readonly editStack = new EditStack();
    private readonly queue = new AsyncQueue<IEditDispatchResult | undefined>();
    private readonly _in: IEditChannel;
    private readonly _out: IEditChannel;

    private _isUndo = false;
    private _isRedo = false;

    constructor(incoming: IEditChannel, outgoing: IEditChannel) {
        this._in = incoming;
        this._out = outgoing;

        this.listeners.push(this._in.createObserver()
            .filter(result => result.success && result.response !== undefined)
            .on(this.handleEditDispatched.bind(this)));
    }

    get isUndo(): boolean {
        return this._isUndo;
    }

    get isRedo(): boolean {
        return this._isRedo;
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

    undo(): Promise<IEditDispatchResult | undefined> {
        return this.queueUndoRedo(
            this.canUndo.bind(this),
            () => this._isUndo = true,
            () => this._isUndo = false,
            this.editStack.undo.bind(this.editStack));
    }

    redo(): Promise<IEditDispatchResult | undefined> {
        return this.queueUndoRedo(
            this.canRedo.bind(this),
            () => this._isRedo = true,
            () => this._isRedo = false,
            this.editStack.redo.bind(this.editStack));
    }

    private queueUndoRedo(canUndoRedo: () => boolean, start: () => void, end: () => void, invoke: (channel: IEditChannel) => Promise<IEditDispatchResult | undefined>): Promise<IEditDispatchResult | undefined> {
        return this.queue.push(() => {
            if (canUndoRedo()) {
                start();

                return invoke(this._out).then(result => {
                    end();
                    return result;
                });
            }

            return Promise.resolve(undefined);
        });
    }

    private handleEditDispatched(result: IEditDispatchResult): void {
        if (!this._isUndo && !this._isRedo) {
            this.editStack.push(result.edit);
        }
    }
}