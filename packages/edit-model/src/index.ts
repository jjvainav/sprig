import { IEditOperation } from "@sprig/edit-operation";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IModelAttributes, IModel, Model } from "@sprig/model";

export interface IApplyEditCallback {
    (model: IEditModel, edit: IEditOperation, revision: number): Promise<boolean>;
}

/** Defines options for applying edit operations to a model. */
export interface IApplyEditOptions {
    /** 
     * True if the revision number should automatically be incremented if an edit was applied successfully; is true by default.
     * Note: it is useful to set this to false if there is a need to manually set a revision number after applying an edit.
     */
    readonly incrementRevision?: boolean;
}

/** An object defining the attributes for an edit model. */
export interface IEditModelAttributes extends IModelAttributes {
    /** The current revision number for the model. */
    readonly revision: number;
}

/** A callback that handles an edit operation and optionally returns a reverse edit. */
export interface IEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit): IEditOperation | undefined;
}

/** Maps edit handlers to edits based on the edit type. */
export interface IEditHandlerMap {
    readonly [editType: string]: IEditHandler;
}

/** 
 * A callback that provides a list of edits for an edit model. It is expected that the returned edit operations are in order
 * and the model's revision is sequential.
 */
export interface IEditProvider {
    (model: IEditModel, startRevision?: number): Promise<IEditOperation[]>;
}

/** Defines a model object with support for edit operations. */
export interface IEditModel<TAttributes extends IEditModelAttributes = IEditModelAttributes> extends IModel<TAttributes> {
    /** The current revision number for the model. */
    readonly revision: number;
    /** An event that is raised when an edit has been applied to the model. */
    readonly onEditApplied: IEvent<IEditOperation>;
    /** Applies an edit against the model and optionally returns a reverse edit. */
    apply(edit: IEditOperation, options?: IApplyEditOptions): IEditOperation | undefined;

    /** Sets a new revision number for the model. */
    setRevision(revision: number): void;
};

/** 
 * Base class for a Model object that supports edit operations. Note: by default, the model itself is not responsible
 * for moving the revision number forward and must be handled by implementors; however, it is possible to force 
 * the revision number to auto increment when applying an edit.
 */
export abstract class EditModel<TAttributes extends IEditModelAttributes> extends Model<TAttributes> {
    private readonly editApplied = new EventEmitter<IEditOperation>("edit-applied");
    private readonly editHandlers = new Map<string, IEditHandler<any>>();

    revision: number;

    constructor(id?: string, revision?: number) {
        super(id);
        this.revision = revision || 1;
    }

    get onEditApplied(): IEvent<IEditOperation> {
        return this.editApplied.event;
    }

    /** Applies the specified edit and optionally returns a reverse edit. */
    apply(edit: IEditOperation, options?: IApplyEditOptions): IEditOperation | undefined {
        const handler = this.editHandlers.get(edit.type);
        let reverse: IEditOperation | undefined;
        
        if (handler) {
            reverse = handler(edit);

            if (!options || !options.incrementRevision === undefined || options.incrementRevision) {
                this.revision++;
            }

            this.editApplied.emit(edit);
        }

        return reverse;
    }

    canApply(edit: IEditOperation): boolean {
        return this.editHandlers.has(edit.type);
    }

    setRevision(revision: number): void {
        this.revision = revision;
    }

    

    protected registerHandler<TEdit extends IEditOperation = IEditOperation>(type: string, editHandler: IEditHandler<TEdit>): void {
        this.editHandlers.set(type, editHandler);
    }
}

/** 
 * A helper class that provides synchronization support for an edit model. The given edit provider
 * is responsible for returning new edits for the edit model that will then be applied in order
 * to bring the edit model up-to-date.
 */
export class Synchronizer {
    private readonly applyEdit: IApplyEditCallback
    private syncPromise?: Promise<void>;

    constructor(
        private readonly model: IEditModel,
        private readonly editProvider: IEditProvider,
        applyEdit?: IApplyEditCallback) {
            this.applyEdit = applyEdit || ((model, edit, revision) => {
                model.apply(edit, { incrementRevision: false });
                model.setRevision(revision);
                return Promise.resolve(true);
            });
    }

    synchronize(): Promise<void> {
        if (this.syncPromise) {
            // there is already a sync in progress
            return this.syncPromise;
        }

        const doSynchronize = async (): Promise<void> => {
            // assume the model's current revision is accurate
            const revision = this.model.revision;
            const startRevision = revision + 1;
            const edits = await this.editProvider(this.model, startRevision);

            // check if the version changed while fetching edits from the version; if so, try again
            if (this.model.revision !== revision) {
                return doSynchronize();
            }

            for (let i = 0; i < edits.length; i++) {
                await this.applyEdit(this.model, edits[i], i + startRevision);
            }
        };

        this.syncPromise = doSynchronize()
            .then(() => this.syncPromise = undefined)
            .catch(err => {
                this.syncPromise = undefined;
                throw err;
            });

        return this.syncPromise;
    }
}