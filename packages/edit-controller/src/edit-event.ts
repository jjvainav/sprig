import { IEditOperation } from "@sprig/edit-operation";

/** Defines an event representing an edit operation that had been applied. */
export interface IEditEvent {
    /** An edit operation to apply to the model. */
    readonly edit: IEditOperation;
    /** A Unix timestamp (in seconds) associated with the edit. */
    readonly timestamp: number;
    /** The revision number for the edit. */
    readonly revision: number;
}