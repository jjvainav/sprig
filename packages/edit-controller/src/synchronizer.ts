import { IEditOperation } from "@sprig/edit-operation";
import { IModel } from "@sprig/model";

export interface IApplyEditCallback {
    (edit: IEditOperation, revision: number): Promise<boolean>;
}

/** 
 * A callback that provides a list of edits for an edit model. It is expected that the returned edit operations are in order
 * and the model's revision is sequential.
 */
export interface IEditProvider {
    (startRevision?: number): Promise<IEditOperation[]>;
}

/** 
 * A helper class that provides synchronization support for an model. The given edit provider
 * is responsible for returning new edits for the model that will then be applied in order
 * to bring the model up-to-date.
 */
 export class Synchronizer {
    private syncPromise?: Promise<void>;

    constructor(
        private readonly model: IModel,
        private readonly editProvider: IEditProvider,
        private readonly applyEdit: IApplyEditCallback) {
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
            const edits = await this.editProvider(startRevision);

            // check if the version changed while fetching edits from the version; if so, try again
            if (this.model.revision !== revision) {
                return doSynchronize();
            }

            for (let i = 0; i < edits.length; i++) {
                await this.applyEdit(edits[i], i + startRevision);
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