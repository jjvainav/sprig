import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { EventEmitter, IEvent, IEventListener } from "@sprig/event-emitter";
import { IModel } from "@sprig/model";
import { Synchronizer } from "./synchronizer";

/** Defines a callback responsible for synchronizing a model. */
export type SyncModelCallback = () => Promise<void>;

/** Defines the result for an apply edit handler. */
export type ApplyResult<TReverse extends IEditOperation = IEditOperation> = IApplyEditHandlerSuccess<TReverse> | IApplyEditHandlerFail;

/** Defines the result for a submit edit handler. */
export type SubmitResult = ISubmitEditHandlerSuccess | ISubmitEditHandlerFail;

/** Defines handlers for a specific edit operation. */
type EditHandlers<TEdit extends IEditOperation = IEditOperation> = {
    readonly apply: IApplyEditHandler<TEdit>;
    readonly submit: ISubmitEditHandler<TEdit>;
};

/** A callback that handles applying an edit operation and return a reverse edit. */
export interface IApplyEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit): ApplyResult | Promise<ApplyResult>;
}

/** Indicates a handler has successfully applied an edit. */
export interface IApplyEditHandlerSuccess<TReverse extends IEditOperation = IEditOperation> {
    readonly success: true;
    readonly reverse: TReverse;
}

/** Indicates a handler has failed to apply an edit. */
export interface IApplyEditHandlerFail {
    readonly success: false;
    readonly error?: any;
}

/** Defines the result of applying an edit against a model. */
export interface IApplyEditResult {
    /** True if successfully applied. */
    readonly success: boolean;
    /** The edit that was applied or failed to apply if success is false. */
    readonly edit: IEditOperation;
    /** A reverse edit that will be included when successful. */
    readonly reverse?: IEditOperation;
}

/** Represents an edit event stream. */
export interface IEditEventStream {
    /** An event that is raised when data has been received from the stream. */
    readonly onData: IEvent<IEditEventStreamData>;
}

/** Defines the data expected from an edit event stream. */
export interface IEditEventStreamData {
    /** The id of the model the edit applies to. */
    readonly modelId: string;
    /** The type of model the edit applies to. */
    readonly modelType: string;
    /** An edit operation to apply to the model. */
    readonly edit: IEditOperation;
    /** The revision number for the edit. */
    readonly revision: number;
}

/** Defines the result of publishing an edit. */
export interface IPublishEditResult {
    /** True if successfully published. */
    readonly success: boolean;
    /** The edit that was published. */
    readonly edit: IEditOperation;
    /** A Promise that can be awaited for the publish to complete (the publish is completed after the edit has been applied and then submitted). */
    readonly waitForSubmit: Promise<ISubmitEditResult>;
}

/** Represents the result of a submission. */
export interface ISubmitEditResult {
    /** True if the submission was successful; otherwise false. */
    readonly success: boolean;
    /** The edit that was submitted or failed to submit if success is false. */
    readonly edit: IEditOperation;
    /** 
     * The reverse for the edit if it was successfully applied before submission; if the submission
     * failed, reverse will be the reverse edit that was applied to rollback the model.
     */
    readonly reverse?: IEditOperation;
    /** Optional data if a response was returned from the submission. */
    readonly data?: any;
    /** Optional error details that may be defined if the submission failed. */
    readonly error?: any;
}

/** A callback responsible for submitting an edit to the server. */
export interface ISubmitEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit): Promise<SubmitResult>;
}

/** Indicates a handler has successfully submitted an edit. */
export interface ISubmitEditHandlerSuccess {
    readonly success: true;
    /** The updated revision number for the model. */
    readonly revision: number;
    /** Optional response data from the submission. */
    readonly data?: any;
}

/** Indicates a handler has failed to submit an edit. */
export interface ISubmitEditHandlerFail {
    readonly success: false;
    readonly error?: any;
}

/** Defines a queue for applying and submitting edits while maintaining revision order. */
export interface IPublishEditQueue {
    /** Creates a channel for publishing edits. */
    createChannel(options: IPublishEditChannelOptions): IPublishEditChannel;
    /** Connects the queue to the edit event stream. */
    connectStream(): void;
    /** Disconnects the queue from the edit event stream. */
    disconnectStream(): void;
    /** Returns a promise that will wait for all submit processes to complete. */
    waitForAllSubmits(): Promise<void>;
    /** Returns a promise to wait for the queue to be completely idle; this will wait for all pending edits to be applied and submitted as well as wait for any received edit events to be processed as well. */
    waitForIdle(): Promise<void>;
    /** Returns a promise to wait for the given edit to be submitted or returns undefined if the edit has already been submitted or a submission was not found. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined>;
}

/** Defines the options needed to create a publish edit channel. */
export interface IPublishEditChannelOptions {
    readonly model: IModel;
    readonly syncModel: SyncModelCallback;
    readonly apply: IApplyEditHandler;
    readonly submit: ISubmitEditHandler;
}

/** Defines a channel to the publish edit queue for pushing edits. */
export interface IPublishEditChannel {
    push(edit: IEditOperation): Promise<IPublishEditResult>;
}

/** Handles an edit event from the stream or optionally return an edit controller to forward the event for handling. */
export interface IEditEventStreamHandler {
    (data: IEditEventStreamData): EditController | undefined | Promise<EditController | undefined> | void;
}

/** Maintains the state for an edit while publishing (e.g. apply and submit process). */
interface IPublishEditContext {
    readonly model: IModel;
    readonly waitForSubmit: Promise<ISubmitEditResult>;
    readonly reject: (err: any) => void;
    readonly resolve: (result: ISubmitEditResult) => void;
}

function isApplyEditHandlerSuccess(result: ApplyResult): result is IApplyEditHandlerSuccess {
    return (<IApplyEditHandlerSuccess>result).success;
}

function isSubmitEditHandlerSuccess(result: SubmitResult): result is ISubmitEditHandlerSuccess {
    return (<ISubmitEditHandlerSuccess>result).success;
}

function isPublishEditQueue(streamOrQueue: IEditEventStream | IPublishEditQueue): streamOrQueue is IPublishEditQueue {
    return (<IPublishEditQueue>streamOrQueue).createChannel !== undefined;
}

/** 
 * Controls applying and synchronizing edits for a model with a remote source using event streams and edit operations. 
 * 
 * Publising an edit involves applying it to the model and submitting it to a remote server.
 * In order to support immediate feedback, edits are first applied and then submitted in the background. 
 * Note, failures during the submission will automatically be rolled back by applying a reverse edit.
 * 
 * The controller also manages synchronizing edits if the model's revision is not in sync and also listens for edits from an event stream. 
 * If at any time the model's revision number gets out of sync the controller will fetch missing edits from the server and get it back in sync.
 */
export abstract class EditController<TModel extends IModel = IModel> {
    private readonly editApplied = new EventEmitter<IEditOperation>();
    private readonly handlers: { [editType: string]: EditHandlers<any> } = {};

    private readonly synchronizer: Synchronizer;
    private readonly channel: IPublishEditChannel;

    /** The edit queue used to manage publishing edits for the controller. */
    protected readonly editQueue: IPublishEditQueue;

    /** The model type the controller is responsible for and is expected to be the model type for an edit event. */
    abstract readonly modelType: string;

    /** 
     * Creates a new edit controller using the specified stream. The edit controller will maintain its own queue for
     * publishing, submitting, and syncing edits. This is useful when a stream of events will only apply to the
     * model the controller references (or its children). The controller will automatically connect to the stream
     * when created.
     */
    constructor(model: TModel, stream: IEditEventStream);
    /** Creates a new edit controller using the specified queue. */
    constructor(model: TModel, queue: IPublishEditQueue);
    constructor(model: TModel, streamOrQueue: IEditEventStream | IPublishEditQueue);
    constructor(readonly model: TModel, streamOrQueue: IEditEventStream | IPublishEditQueue) {
        if (model.isNew()) {
            throw new Error("Edit controller does not support new models.");
        }

        this.editQueue = isPublishEditQueue(streamOrQueue)
            ? streamOrQueue
            : new PublishEditQueue(streamOrQueue, data => this.getController(data));

        this.synchronizer = new Synchronizer(
            this.model, 
            (startRevision) => this.fetchEdits(startRevision),
            (edit, revision) => this.applyEdit(edit, revision).then(result => result.success));

        this.channel = this.editQueue.createChannel({
            model,
            syncModel: () => this.synchronizer.synchronize(),
            submit: edit => this.handleSubmitEdit(edit),
            apply: edit => this.handleApplyEdit(edit)
        });
    }

    /** An event that is raised after an edit has been applied to the model. */
    get onEditApplied(): IEvent<IEditOperation> {
        return this.editApplied.event;
    }

    /** Connects the edit queue to the event stream. Note, this will effect all controllers sharing the same edit queue. */
    connectStream(): void {
        this.editQueue.connectStream();
    }

    /** Disconnects the edit queue from the event stream. Note, this will effect all controllers sharing the same edit queue. */
    disconnectStream(): void {
        this.editQueue.disconnectStream();
    }

    /** Returns a promise to wait for all pending edits to be applied and submitted; note, this will not wait for edits that were received via the stream. */
    waitForAllSubmits(): Promise<void> {
        return this.editQueue.waitForAllSubmits();
    }

    /** Returns a promise to wait for the queue to be completely idle; this will wait for all pending edits to be applied and submitted as well as wait for any received edit events to be processed as well. */
    waitForIdle(): Promise<void> {
        return this.editQueue.waitForIdle();
    }

    /** Returns a promise that will wait for the specified edit to be submitted. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        return this.editQueue.waitForSubmit(edit);
    }

    /** Fetches new edits for the current model starting at the specified revision number. */
    protected abstract fetchEdits(startRevision?: number): Promise<IEditOperation[]>;

    /** Manually apply an edit against a model (but does not submit) and associate the specified revision number. */
    protected applyEdit(edit: IEditOperation, revision: number): Promise<IApplyEditResult> {
        // create a separate channel so that will simply return success for the submission, this will skip the submission step
        const channel = this.editQueue.createChannel({ 
            model: this.model,
            syncModel: () => this.synchronizer.synchronize(), 
            apply: edit => this.handleApplyEdit(edit), 
            submit: () => Promise.resolve({ success: true, revision }) 
        });

        // when the apply fails attempt to sync the model and return an unsuccessful result
        const syncOnFail = () => this.synchronizer.synchronize().then(() => ({ success: false, edit }));

        // revisions are expected to be in sequential order; otherwise, force a sync without applying the edit
        if (this.model.revision + 1 !== revision) {
            return syncOnFail();
        }

        return channel.push(edit).then(async result => {
            if (result.success) {
                // if successful wait for the submission to finish so that we can get the reverse edit (this is expected to always succeed)
                const submitResult = await result.waitForSubmit;
                return { success: submitResult.success, edit, reverse: submitResult.reverse };
            }
            
            // if we fail, attempt to synchronize the model
            return await syncOnFail();
        });
    }

    /** 
     * Gets the controller to handle the specified edit event; by default, the current controller is returned. 
     * This is useful when the controller child models and can provide a different controller
     * to handle the event.
     */
    protected getController(data: IEditEventStreamData): EditController | undefined {
        return this;
    }

    /** 
     * Handles an event received from the stream; the default behavior is to check if the data is for the current model and 
     * then apply the edit. Subclasses can override this to provide additional handling as needed.
     */
    protected async handleEditEvent(data: IEditEventStreamData): Promise<void> {
        if (this.modelType === data.modelType && this.model.id === data.modelId) {
            // ignore edit unless the revision is greater
            if (this.model.revision < data.revision) {
                // TODO: if the revision is not sequential should this sync instead of apply?
                // TODO: what if the edit fails to apply? force a sync?
                await this.applyEdit(data.edit, data.revision);
            }
        }
    }

    /** 
     * Applies and submits the specified edit. The returned promise will wait for the published edit to be applied but not submitted; 
     * the result will include another promise that can be used to await the submission if necessary.
     */
    protected publishEdit<TEdit extends IEditOperation = IEditOperation>(edit: TEdit): Promise<IPublishEditResult> {
        return this.channel.push(edit);
    }

    /** Registers a set of apply and submit handlers for an edit operation. */
    protected registerEditHandlers<TEdit extends IEditOperation>(editType: string, handlers: EditHandlers<TEdit>): void {
        this.handlers[editType] = handlers;
    }

    /** Starts a sync process for the specified model. */
    protected syncModel(): Promise<void> {
        return this.synchronizer.synchronize();
    }

    private handleApplyEdit(edit: IEditOperation): Promise<ApplyResult> {
        const handlers = this.handlers[edit.type];
        if (!handlers) {
            return Promise.resolve({ 
                success: false,
                error: new Error(`Apply handler not registered for edit (${edit.type}).`) 
            });
        }

        return Promise.resolve(handlers.apply(edit))
            .then(result => {
                if (isApplyEditHandlerSuccess(result)) {
                    this.editApplied.emit(edit);
                }

                return result;
            })
            .catch(error => ({ success: false, error }));
    }

    private handleSubmitEdit(edit: IEditOperation): Promise<SubmitResult> {
        const handlers = this.handlers[edit.type];
        if (!handlers) {
            return Promise.resolve({ 
                success: false,
                error: new Error(`Submit handler not registered for edit (${edit.type}).`) 
            });
        }

        return handlers.submit(edit);
    }
}

export class PublishEditQueue implements IPublishEditQueue {
    private readonly editContexts = new Map<IEditOperation, IPublishEditContext>();
    private readonly submissions = new Set<Promise<ISubmitEditResult>>();

    private readonly publishQueue = new AsyncQueue<IPublishEditResult>();
    private readonly eventQueue = new AsyncQueue();

    private eventQueuePromise = Promise.resolve();
    private streamListener?: IEventListener;

    /** Initializes a new instance of the PublishEditQueue and automatically connects to the given stream. */
    constructor(
        private readonly stream: IEditEventStream, 
        private readonly streamHandler: IEditEventStreamHandler) {
        this.connectStream();
    }

    connectStream(): void {
        if (!this.streamListener) {
            this.streamListener = this.stream.onData(data => {
                // applying an edit is an asynchronous operation so use a queue to process events in order as they are received
                // also capture the promise so that it can be used to wait for the queue to finish processing events
                this.eventQueuePromise = this.eventQueue.push(async () => {
                    // give the event stream data to the provided handler to handle
                    // it is possible the server will send an edit before the original submit has
                    // had a chance to respond so wait for all pending submissions before processing the event
                    await this.waitForAllSubmits().then(async () => {
                        const controller = await Promise.resolve(this.streamHandler(data));

                        if (controller) {
                            // ideally the function should not be public
                            (<any>controller).handleEditEvent(data);
                        }
                    });
                });
            });
        }
    }

    createChannel(options: IPublishEditChannelOptions): IPublishEditChannel {
        return {
            push: edit => {
                const context = this.savePublishEditContext(options.model, edit);
                return this.publishQueue.push(async () => {
                    const applyResult: ApplyResult = await Promise.resolve(options.apply(edit)).catch(error => ({ success: false, error }));

                    if (isApplyEditHandlerSuccess(applyResult)) {
                        // if successful start the submit process and let it run in the background
                        // the submit process will resolve the context when finished
                        this.submitEdit(
                            context, 
                            edit, 
                            applyResult.reverse, 
                            options.syncModel, 
                            options.submit,
                            options.apply);
                    }
                    else {
                        context.resolve({ success: false, edit, error: applyResult.error });
                    }

                    return { success: applyResult.success, edit, waitForSubmit: context.waitForSubmit };
                });
            }
        };
    }

    disconnectStream(): void {
        if (this.streamListener) {
            this.streamListener.remove();
            this.streamListener = undefined;
        }
    }

    async waitForAllSubmits(): Promise<void> {
        await Promise.all(Array.from(this.submissions.values()));
    }

    async waitForIdle(): Promise<void> {
        // wait for the event queue first as it maybe in the process of handling an event
        await this.eventQueuePromise;
        await this.waitForAllSubmits();
    }

    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        const context = this.editContexts.get(edit);
        return context ? context.waitForSubmit : Promise.resolve(undefined);
    }

    private savePublishEditContext(model: IModel, edit: IEditOperation): IPublishEditContext {
        let reject!: (err: any) => void;
        let resolve!: (result: ISubmitEditResult) => void;
        // note: the submission will be handled in the background; if it is necessary to wait for the submission to complete use the waitForSubmit function
        const waitForSubmit = this.saveSubmissionPromise(new Promise((res: (value: ISubmitEditResult) => void, rej) => {
            resolve = res;
            reject = rej;
        }));

        const context: IPublishEditContext = {
            model,
            waitForSubmit,
            reject: err => {
                reject(err);
                this.editContexts.delete(edit);
            },
            resolve: result => {
                resolve(result);
                this.editContexts.delete(edit);
            }
        };

        this.editContexts.set(edit, context);

        return context;
    }

    private saveSubmissionPromise(promise: Promise<ISubmitEditResult>): Promise<ISubmitEditResult> {
        this.submissions.add(promise);
        return promise
            .then(result => {
                this.submissions.delete(promise);
                return result;
            })
            .catch(err => {
                this.submissions.delete(promise);
                throw err;
            });
    }

    private async submitEdit(context: IPublishEditContext, edit: IEditOperation, reverse: IEditOperation, syncModel: SyncModelCallback, submit: ISubmitEditHandler, apply: IApplyEditHandler): Promise<void> {
        // apply a reverse edit since the published edit has already been applied and then sync the model
        // TODO: how to best handle the error when applying the reverse edit
        const reverseAndSync = (reverse: IEditOperation) => Promise.resolve(apply(reverse))
            .then(() => syncModel())
            .catch(() => syncModel());

        // if we fail to submit capture the error and reverse
        const result = await submit(edit).catch(error => (<ISubmitEditHandlerFail>{ success: false, error }));
        if (isSubmitEditHandlerSuccess(result)) {
            // the revision should always move forward
            if (context.model.revision < result.revision) {
                // the revision numbers are expected to be sequential; if out of sync, resync the model and 
                // do not set the revision number, that should be handled by the sync process
                if (context.model.revision + 1 !== result.revision) {
                    return syncModel()
                        .then(() => context.resolve({ success: true, edit, reverse, data: result.data }))
                        .catch(err => context.reject(err));
                }

                context.model.setRevision(result.revision);
            }
            
            context.resolve({ success: true, edit, reverse, data: result.data });
        }
        else {
            await reverseAndSync(reverse)
                .then(() => context.resolve({ success: false, edit, reverse, error: result.error }))
                .catch(err => context.reject(err));
        }
    }
}