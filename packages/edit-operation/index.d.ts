/** Represents an edit operation for a resource. */
export interface IEditOperation<TData = any> {
    /** Defines the type of edit. */
    readonly type: string;
    /** The data associated with the edit. */
    readonly data: TData;
}