import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditChannel, IEditChannelPublisher, IEditQueue } from "@sprig/edit-queue";
import { EventEmitter, IEvent, IEventListener } from "@sprig/event-emitter";

/** A callback that handles applying an edit operation and return a reverse edit. */
export interface IApplyEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit): IApplyEditResult | Promise<IApplyEditResult>;
}

/** Defines the result of applying an edit against a model. */
export interface IApplyEditResult<TReverseEdit extends IEditOperation = IEditOperation> {
    /** True if successfully applied. */
    readonly success: boolean;
    /** The edit that was applied. */
    readonly edit: IEditOperation;
    /** A reverse edit that will be included when successful. */
    readonly reverse?: TReverseEdit;
    /** An optional error if the apply failed. */
    readonly error?: any;
}

/** Defines a context for an edit that has been published. */
export interface IPublishEditContext {
    /** Cancels the edit if it has not yet been applied and will return true if successfully aborted. */
    cancel(): boolean;
    /** Waits until after the edit has been applied. */
    waitForApply(): Promise<IApplyEditResult>;
    /** Waits until after the edit has been submitted; this happens after it has been applied and if the edit failed to apply this will return as an unsuccessful submit result. */
    waitForSubmit(): Promise<ISubmitEditResult>;
}

export interface IEditController<TModel extends IModel = IModel> {
    /** An event that is raised after an edit has been applied. */
    readonly onEditApplied: IEvent<IApplyEditResult>;
    /** An event that is raised after an edit has been submitted. */
    readonly onEditSubmitted: IEvent<ISubmitEditResult>;
    /** An event that is raised whenever the controller had to synchronize. */
    readonly onSynchronized: IEvent<ISynchronizeResult>;
    readonly model: TModel
    readonly modelType: string;
    readonly processManager: IEditProcessManager;
    /** 
     * Applies an edit against the controller's model immediately without going through the apply channel or submitting. 
     * Most edits should be published and this only used in special situations where an edit needs to be manually applied.
     */
    applyEdit(edit: IEditOperation, revision?: number): Promise<IApplyEditResult>;
    /** Connects the stream used by the underlying process manager. */
    connectStream(): void;
    /** 
     * Creates a publisher that can be used to publish edits against the model; the publisher will wait until the edit has been applied. 
     * Note: edits published against this publisher will still be submitted in the background.
     */
    createApplyPublisher(): IEditChannelPublisher<IApplyEditResult>;
    /** Disconnects the stream used by the underlying process manager. */
    disconnectStream(): void;
    getApplyHandler<TEdit extends IEditOperation>(edit: TEdit): IApplyEditHandler<TEdit> | undefined;
    getSubmitHandler<TEdit extends IEditOperation>(edit: TEdit): ISubmitEditHandler<TEdit> | undefined;
    /** Queues an edit to be applied and submitted; if a revision number is provided the edit will only be applied and not submitted. */
    publishEdit<TEdit extends IEditOperation = IEditOperation>(edit: TEdit, revision?: number): IPublishEditContext;
    /** Forces the controller to synchronize its model. */
    synchronize(): Promise<ISynchronizeResult>;
    /** Returns a promise to wait for the queue to be completely idle; this will wait for all pending edits to be applied and submitted as well as wait for any received edit events to be processed as well. */
    waitForIdle(): Promise<void>;
    /** Returns a promise that will wait for the specified edit to finish processing; this will be undefined if the edit has already been processed. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined>;
}

/** Defines options for creating an edit controller. */
export interface IEditControllerOptions<TModel extends IModel> {
    readonly model: TModel;
    readonly modelType: string;
    /** A set of edit handlers for the controller; when not extending the edit controller this will be required. */
    readonly handlers?: { [editType: string]: IEditHandlers<any> };
    /** Gets an edit controller for a specified model; this is used when handling parent/child relationships where a child has its own controller; this will be ignored if an process manager is provided. */
    readonly controllerProvider?: IEditControllerProvider;
    /** A process manager for the controller; this is useful when wanting to share a stream and/or queues for processing edits across multiple controllers. */
    readonly processManager?: IEditProcessManager;
    /** An event stream to listen for edits from a remote source; this will be ignored if an process manager is provided. */
    readonly stream?: IEditEventStream;
    /** An object responsible for keeping the controller's model up to date. */
    readonly synchronizer: ISynchronizer;
}

/** Defines a callback that will provide a controller for a model. */
export interface IEditControllerProvider {
    (modelType: string, modelId: string): Promise<IEditController | undefined> | IEditController | undefined;
}

/** Defines an event representing an edit operation that had been applied. */
export interface IEditEvent {
    /** An edit operation to apply to the model. */
    readonly edit: IEditOperation;
    /** A Unix timestamp (in seconds) associated with the edit. */
    readonly timestamp: number;
    /** The revision number for the edit. */
    readonly revision: number;
}

/** A callback that provides a list of edit events for a model. */
export interface IEditEventProvider {
    (model: IModel, modelType: string, startRevision?: number): Promise<IEditEvent[]>;
}

/** Represents an edit event stream. */
export interface IEditEventStream {
    /** An event that is raised when data has been received from the stream. */
    readonly onData: IEvent<IEditEventStreamData>;
}

/** Defines the data expected from an edit event stream. */
export interface IEditEventStreamData extends IEditEvent {
    /** The id of the model the edit applies to. */
    readonly modelId: string;
    /** The type of model the edit applies to. */
    readonly modelType: string;
}

export interface IEditHandlers<TEdit extends IEditOperation = IEditOperation> {
    readonly apply: IApplyEditHandler<TEdit>;
    readonly submit?: ISubmitEditHandler<TEdit>;
}

/** Manages the process of handling edits as they are received from a stream and applied/submitted. */
export interface IEditProcessManager {
    connectStream(): void;
    /** 
     * Creates a publisher that can be used to publish edits against the model; the publisher will wait until the edit has been applied. 
     * Note: edits published against this publisher will still be submitted in the background.
     */
    createApplyPublisher(controller: IEditController): IEditChannelPublisher<IApplyEditResult>;
    disconnectStream(): void;
    /** Queues an edit to be processed and returns a promise that will wait until it has been applied. */
    publishEdit<TEdit extends IEditOperation = IEditOperation>(controller: IEditController, edit: TEdit, revision?: number): IPublishEditContext;
    waitForIdle(): Promise<void>;
    /** Waits for a processing edit to complete; this will return undefined if the edit failed to apply or has already finished processing. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined>;
}

export interface IModel {
    readonly id: string;
    readonly revision: number;
    setRevision(revision: number): void;
}

/** A callback responsible for submitting an edit to the server. */
export interface ISubmitEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit): Promise<ISubmitEditResult>;
}

/** Represents the result of a submission. */
export interface ISubmitEditResult {
    /** True if the submission was successful; otherwise false. */
    readonly success: boolean;
    /** The edit that was submitted or failed to submit if success is false. */
    readonly edit: IEditOperation;
    /** The new revision number assigned to the edit that was submitted. */
    readonly revision?: number;
    /** Optional error details that may be defined if the submission failed. */
    readonly error?: any;
}

/** Defines an object responsible for keeping a controller's model up to date. */
export interface ISynchronizer {
    synchronize(controller: IEditController): Promise<ISynchronizeResult>;
}

export interface ISynchronizeResult {
    readonly success: boolean;
    readonly error?: any;
}

interface IEditContext {
    readonly edit: IEditOperation;
    readonly controller: IEditController;
    readonly revision?: number;
    /** True if the edit can be canceled. */
    canCancel: boolean;
    /** True if the edit has been canceled. */
    isCanceled?: boolean;
    /** Used to track the order of the edit in a queue. */
    order: number;
    /** A reverse edit that can be used to rollback the edit if it has already been applied. */
    reverse?: IEditOperation;
    /** Submit handler for the edit; this is set when an edit is being applied and used during the submission. */
    submit?: ISubmitEditHandler;
    cancel(): boolean;
    onApply(result: IApplyEditResult): IApplyEditResult;
    onApplyFail(error: any): IApplyEditResult;
    onSubmit(result: ISubmitEditResult): ISubmitEditResult;
    onSubmitFail(error: any): ISubmitEditResult;
    waitForApply(): Promise<IApplyEditResult>;
    waitForSubmit(): Promise<ISubmitEditResult>;
}

export class EditController<TModel extends IModel = IModel> implements IEditController<TModel> {
    private readonly editApplied = new EventEmitter<IApplyEditResult>();
    private readonly editSubmitted = new EventEmitter<ISubmitEditResult>();
    private readonly synchronized = new EventEmitter<ISynchronizeResult>();
    private readonly handlers = new Map<string, IEditHandlers<any>>;

    private readonly synchronizer: ISynchronizer;

    readonly model: TModel; 
    readonly modelType: string;
    readonly processManager: IEditProcessManager;

    constructor(options: IEditControllerOptions<TModel>) {
        this.model = options.model;
        this.modelType = options.modelType;
        this.synchronizer = options.synchronizer;

        if (options.handlers) {
            for (const key in options.handlers) {
                this.handlers.set(key, options.handlers[key]);
            }
        }

        this.processManager = options.processManager || new EditProcessManager(
            options.controllerProvider || ((modelType, modelId) => this.getController(modelType, modelId)),
            options.stream
        );

        this.connectStream();
    }

    get onEditApplied(): IEvent<IApplyEditResult> {
        return this.editApplied.event;
    }

    get onEditSubmitted(): IEvent<ISubmitEditResult> {
        return this.editSubmitted.event;
    }

    get onSynchronized(): IEvent<ISynchronizeResult> {
        return this.synchronized.event;
    }

    async applyEdit(edit: IEditOperation, revision?: number): Promise<IApplyEditResult> {
        const handler = this.getApplyHandler(edit);
        if (!handler) {
            return { success: false, edit, error: new Error(`Unable to find apply handler for edit (${edit.type}) with controller for model type (${this.modelType}) and id (${this.model.id}).`) };
        }

        const result = await Promise.resolve(handler(edit))
            .catch(error => ({ success: false, edit, error: new Error(`Error caught applying immediate edit (${edit.type}).`, { cause: error }) }));

        if (result.success && revision) {
            this.model.setRevision(revision);
        }

        return result;
    }

    connectStream(): void {
        this.processManager.connectStream();
    }

    createApplyPublisher(): IEditChannelPublisher<IApplyEditResult> {
        return this.processManager.createApplyPublisher(this);
    }

    disconnectStream(): void {
        this.processManager.disconnectStream();
    }

    getApplyHandler<TEdit extends IEditOperation>(edit: TEdit): IApplyEditHandler<TEdit> | undefined {
        return this.hookHandler(this.handlers.get(edit.type)?.apply, this.editApplied);
    }

    getSubmitHandler<TEdit extends IEditOperation>(edit: TEdit): ISubmitEditHandler<TEdit> | undefined {
        return this.hookHandler(this.handlers.get(edit.type)?.submit, this.editSubmitted);
    }

    publishEdit<TEdit extends IEditOperation = IEditOperation>(edit: TEdit, revision?: number): IPublishEditContext {
        return this.processManager.publishEdit(this, edit, revision);
    }

    synchronize(): Promise<ISynchronizeResult> {
        return this.synchronizer.synchronize(this)
            .then(result => {
                this.synchronized.emit(result);
                return result;
            })
            .catch(error => {
                const result = { success: false, error: new Error("Uncaught error during synchronization.", { cause: error }) };
                this.synchronized.emit(result);
                return result;
            });
    }

    waitForIdle(): Promise<void> {
        return this.processManager.waitForIdle();
    }

    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        return this.processManager.waitForSubmit(edit);
    }

    /** Gets an edit controller for the specified model; this is used when handling parent/child relationships where the child has its own controller. */
    protected getController(modelType: string, modelId: string): Promise<IEditController | undefined> | IEditController | undefined {
        return this.modelType === modelType && this.model.id === modelId ? this : undefined;
    }

    protected registerEditHandlers<TEdit extends IEditOperation>(editType: string, handlers: IEditHandlers<TEdit>): void {
        this.handlers.set(editType, handlers);
    }

    private hookHandler<TResult>(handler: ((edit: IEditOperation) => TResult | Promise<TResult>) | undefined, emitter: EventEmitter<TResult>): ((edit: IEditOperation) => Promise<TResult>) | undefined {
        // hook the handler to raise an event when processed
        return handler && (async edit => {
            const result = await Promise.resolve(handler(edit));
            emitter.emit(result);
            return result;
        });
    }
}

/** 
 * Defines an object that manages the process of applying and submitting edits to a remote store. 
 * The process manager takes an 'eventual consistency' approach with keeping the data in sync 
 * with the store. 
 * 
 * Edits are applied and submitted in the background in order to allow for a responsive UI when editing data.
 * The reconciliation process consists of submitting edits to the remote store and updating a model's revision.
 * 
 * If the edits or model get out of sync the process manager will pause the apply/publish queues and attempt
 * to re-sync the model by rolling back applied but not committed edits and then fetching latest edits from the remot store.
 * 
 * Lastly, the process manager checks the validity of a model by assuming revision numbers are sequential. 
 */
export class EditProcessManager implements IEditProcessManager {
    private readonly idle = new EventEmitter();
    private readonly editContexts = new Map<IEditOperation, IEditContext>();

    private readonly applyQueue: IEditQueue<IApplyEditResult>;
    private readonly submitQueue: IEditQueue<ISubmitEditResult>;
    private readonly applyChannel: IEditChannel<IApplyEditResult>;
    private readonly submitChannel: IEditChannel<ISubmitEditResult>;
    private readonly applyChannelPublisher: IEditChannelPublisher<IApplyEditResult>;
    private readonly submitChannelPublisher: IEditChannelPublisher<ISubmitEditResult>;

    private readonly eventQueue = new AsyncQueue();
    private nextOrder = 1;

    private lastEditApplied?: IEditOperation;
    private streamListener?: IEventListener;
    private syncPromise?: Promise<ISynchronizeResult>;

    constructor(private readonly getController: IEditControllerProvider, private readonly stream?: IEditEventStream) {
        // note: add a delay to the queues so they can return immediately
        this.applyQueue = new EditQueue<IApplyEditResult>({ delay: 0, dispatcher: edit => this.applyEdit(edit) });
        this.applyChannel = this.applyQueue.createChannel();
        this.applyChannelPublisher = this.applyChannel.createPublisher();

        this.submitQueue = new EditQueue<ISubmitEditResult>({ delay: 0, dispatcher: edit => this.submitEdit(edit) });
        this.submitChannel = this.submitQueue.createChannel();
        this.submitChannelPublisher = this.submitChannel.createPublisher();

        this.eventQueue.onIdle(() => this.emitIfIdle());
    }

    connectStream(): void {
        if (this.stream && !this.streamListener) {
            this.streamListener = this.stream.onData(data => {
                this.eventQueue.push(async () => {
                    const controller = await this.getController(data.modelType, data.modelId);

                    // ignore the event if the controller is not found or the model for the controller is up to date with the received edit
                    if (controller && controller.model.revision < data.revision) {
                        // publish the edit and wait for it to apply before processing the next event
                        const result = await this.publishEdit(controller, data.edit, data.revision).waitForApply();

                        // TODO: check if the error was due to an unexpected or out of sync revision number
                        if (!result.success) {
                            // if we fail to apply the event synchronize
                            await this.synchronize(controller);
                        }
                    }
                });
            });
        }
    }

    createApplyPublisher(controller: IEditController): IEditChannelPublisher<IApplyEditResult> {
        return { 
            publish: edit => this.publishEdit(controller, edit)
                .waitForApply()
                .then(response => ({
                    success: true,
                    channel: this.applyChannel,
                    edit,
                    response 
                }))
        };
    }

    disconnectStream(): void {
        if (this.streamListener) {
            this.streamListener.remove();
            this.streamListener = undefined;
        }
    }

    publishEdit<TEdit extends IEditOperation = IEditOperation>(controller: IEditController, edit: TEdit, revision?: number): IPublishEditContext {
        const context = this.createEditContext(controller, edit, revision);
        this.applyChannelPublisher.publish(edit)
            .then(result => result.response || context.onApplyFail(new Error(`Failed to dispatch edit (${edit.type}).`, { cause: result.error })))
            .catch(error => context.onApplyFail(new Error(`Failed to apply edit (${edit.type}).`, { cause: error })));

        return {
            cancel: context.cancel,
            waitForApply: context.waitForApply,
            waitForSubmit: context.waitForSubmit
        };
    }

    async waitForIdle(): Promise<void> {
        return this.isIdle() ? Promise.resolve() : new Promise(resolve => {
            this.idle.event.once(() => resolve());
        });
    }

    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        const context = this.editContexts.get(edit);
        return Promise.resolve(context && context.waitForSubmit());
    }

    private async applyEdit(edit: IEditOperation): Promise<IApplyEditResult> {
        const context = this.editContexts.get(edit);
        if (!context) {
            return { success: false, edit, error: new Error(`Unexpected edit (${edit.type}) in apply queue.`) };
        }

        if (context.revision) {
            if (context.controller.model.revision >= context.revision) {
                // ignore the edit if a revision is provided and out of date
                return context.onApplyFail(new Error(`Edit (${edit.type}) is out of date.`));
            }

            if (context.controller.model.revision + 1 !== context.revision) {
                // return a failed result and let the caller determine what to do (e.g. synchronize or not)
                return context.onApplyFail(new Error(`Edit (${edit.type}) is newer than expected.`));
            }
        }

        // grab the apply handler to use below
        const apply = context.controller.getApplyHandler(edit);
        if (!apply) {
            return context.onApplyFail(new Error(`Apply handler not found for edit (${edit.type}).`));
        }

        // set the submit handler here so that we can fail early before applying and passing the edit to the submit queue
        // if a revision number is provided use a submit handler that just returns the revision
        context.submit = context.revision 
            ? (edit => Promise.resolve({ success: true, edit, revision: context.revision })) 
            : context.controller.getSubmitHandler(edit);

        if (!context.submit) {
            return context.onApplyFail(new Error(`Submit handler not found for edit (${edit.type}).`));
        }

        if (context.isCanceled) {
            return context.onApplyFail(new Error(`Edit (${edit.type}) has been canceled.`));
        }

        // at this point the edit can no longer be canceled
        context.canCancel = false;
        const result: IApplyEditResult = await Promise.resolve(apply(edit))
            .catch(error => ({ success: false, edit, error: new Error(`Error caught applying edit (${edit.type}).`, { cause: error }) }));

        if (!result.success) {
            return context.onApplyFail(result.error || new Error(`Edit (${edit.type}) failed to apply with unknown error.`));
        }

        this.lastEditApplied = edit;
        this.submitChannelPublisher.publish(edit);
        return context.onApply(result);
    }

    private createEditContext(controller: IEditController, edit: IEditOperation, revision?: number): IEditContext {
        let resolveApply: (result: IApplyEditResult) => void;
        let resolveSubmit: (result: ISubmitEditResult) => void;
        const applyPromise = new Promise<IApplyEditResult>(resolve => resolveApply = resolve);
        const submitPromise = new Promise<ISubmitEditResult>(resolve => resolveSubmit = resolve);
        
        const context: IEditContext = {
            edit,
            canCancel: true,
            controller,
            order: this.nextOrder++,
            revision,
            cancel: () => {
                if (context.canCancel) {
                    context.isCanceled = true;
                }

                return !!context.isCanceled;
            },
            onApply: result => {
                context.reverse = result.reverse;
                resolveApply(result);
                return result;
            },
            onApplyFail: error => {
                // need to also fail the submit so waitForSubmit does not block forever; onSubmitFail will remove/dispose the edit context
                context.onSubmitFail(new Error(`Failed to apply edit (${edit.type}).`, { cause: error }));
                return context.onApply({ success: false, edit, error });
            },
            onSubmit: result => {
                // remove/dispose the edit context after the edit has been submitted
                this.removeEditContext(edit);
                resolveSubmit(result);
                return result;
            },
            onSubmitFail: error => context.onSubmit({ success: false, edit, error }),
            waitForApply: () => applyPromise,
            waitForSubmit: () => submitPromise
        };

        this.editContexts.set(edit, context);

        return context;
    }

    private emitIfIdle(): void {
        if (this.isIdle()) {
            this.idle.emit();
        }
    }

    private isIdle(): boolean {
        return !this.editContexts.size && !this.syncPromise && this.eventQueue.isIdle;
    }

    private async submitEdit(edit: IEditOperation): Promise<ISubmitEditResult> {
        const context = this.editContexts.get(edit);
        if (!context) {
            return { success: false, edit, error: new Error(`Unexpected edit (${edit.type}) in submit queue.`) };
        }

        if (!context.submit) {
            return context.onSubmitFail(new Error(`Submit handler not defined for edit (${edit.type}).`));
        }

        const result: ISubmitEditResult = await context.submit(edit)
            .catch(error => ({ 
                success: false, 
                edit, 
                error: new Error(`Error caught submitting edit (${edit.type}).`, { cause: error }) 
            }));

        if (result.success) {
            if (!result.revision) {
                return context.onSubmitFail(new Error(`Submit for edit (${edit.type}) did not provide a revision number.`));
            }

            if (context.controller.model.revision + 1 === result.revision) {
                context.controller.model.setRevision(result.revision);
                return context.onSubmit(result);
            }
        }

        // rollback the edit if it failed to submit but only if it was also the last edit applied
        // if another edit has been applied rolling back the failed edit could overwrite the value
        // by the other edit; in this use case initiate a synchronization instead of rolling back
        if (context.reverse && this.lastEditApplied === edit) {
            await context.controller.applyEdit(context.reverse);
        }

        // the submit is a background process so if we get here automatically attempt to synchronize
        await this.synchronize(context.controller);
        return context.onSubmitFail(result.error);
    }

    private removeEditContext(edit: IEditOperation): void {
        this.editContexts.delete(edit);
        this.emitIfIdle();
    }

    private async synchronize(controller: IEditController): Promise<ISynchronizeResult> {
        if (this.syncPromise) {
            // if a synchronization is already running wait for it before starting another
            await this.syncPromise;
        }

        // pause the apply channel and wait for it to become idle before attempting to synchronize
        this.applyChannel.pause();
        await this.applyChannel.waitForIdle();

        // note: the controller is expected to catch and handle errors
        return this.syncPromise = controller.synchronize()
            .finally(() => {
                this.syncPromise = undefined;
                this.applyChannel.resume();
                this.emitIfIdle();
            });
    }
}

/** Default synchronizer used to handle synchronizing a controller's model. */
export class Synchronizer implements ISynchronizer {
    constructor(private readonly editEventProvider: IEditEventProvider) {
    }

    async synchronize(controller: IEditController): Promise<ISynchronizeResult> {
        const update = async (): Promise<ISynchronizeResult> => {
            // assume the model's current revision is accurate
            const revision = controller.model.revision;
            const events = await this.editEventProvider(controller.model, controller.modelType, revision + 1);
            
            // check if the version changed while fetching edits from the version; if so, try again
            if (controller.model.revision !== revision) {
                return update();
            }

            events.sort((a, b) => a.revision - b.revision);
            for (const event of events) {
                const result = await controller.applyEdit(event.edit, event.revision);
                if (!result.success) {
                    return { success: false, error: new Error(`Failed to apply edit (${event.edit.type}) while synchronizing.`, { cause: result.error }) };
                }
            }

            return { success: true };
        };

        return update();
    }
}