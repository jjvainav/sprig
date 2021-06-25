import { AsyncQueue } from "@sprig/async-queue";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue as LocalEditQueue, IEditChannel } from "@sprig/edit-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
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

/** Defines the result from connection to an edit event stream. */
export interface IConnectStreamResult<TEventStreamError = any> {
    /** True if the connection was openned successfully. */
    readonly success: boolean;
    /** An error describing the reason for a failed connection. */
    readonly error?: TEventStreamError;
}

/** Handles opening a stream of edit events with a remote source. */
export interface IEditEventStream<TEventStreamData = any, TEventStreamError = any> {
    /** Opens an event stream for receiving edit events from a remote source. */
    openStream(): Promise<IEditEventStreamConnection<TEventStreamData, TEventStreamError>>;
    /** Converts the data received from the stream to an edit event. */
    toEditEvent(data: TEventStreamData): IEditEvent;
}

export interface IEditEventStreamConnection<TEventStreamData = any, TEventStreamError = any> {
    /** An error that is expected to be provided if a connection failed to open. */
    readonly error?: TEventStreamError;
    /** True if the connection is currently open. */
    readonly isOpen: boolean;
    /** An event that is raised when a connection attempt with the event stream has failed. */
    //readonly onError: IEvent<IEventStreamError>;
    /** An event that is raised when data has been received from the stream. */
    readonly onData: IEvent<TEventStreamData>;
    /** An event that is raised when the connection has been opened. */
    //readonly onOpen: IEvent;
    /** Forces a stream to close. */
    close(): void;
}

/** Defines an event for an edit that needs to applied to a specific model. */
export interface IEditEvent {
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
interface IRemoteEditQueue {
    /** Manually apply an edit against the model for the given controller and associates the specified revision number. */
    applyEdit(controller: EditController, edit: IEditOperation, syncModel: SyncModelCallback, revision: number): Promise<IApplyEditResult>;
    /** Connects the edit queue with a remote edit event stream. */
    connectStream(): Promise<IConnectStreamResult>;
    /** Creates a channel for publishing edits against the model of the given controller. */
    createChannel(controller: EditController, syncModel: SyncModelCallback, submit: ISubmitEditHandler): IEditChannel;
    /** Disconnects the edit queue from the remote server. */
    disconnect(): void;
    /** Returns a promise to wait for the given edit to be submitted; returns undefined if the edit has already been submitted or a submission was not found. */
    tryWaitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined>;
    /** Returns a promise that will wait for all submit processes to complete. */
    waitForAllSubmits(): Promise<void>;
    /** Returns a promise to wait for the queue to be completely idle; this will wait for all pending edits to be applied and submitted as well as wait for any received edit events to be processed as well. */
    waitForIdle(): Promise<void>;
    /** Returns a promise to wait for the given edit to be submitted; throws an error if the submission for the edit could not be found. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult>;
}

/** Maintains the state for an edit while publishing (e.g. apply and submit process). */
interface IPublishEditContext {
    readonly controller: EditController;
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

/** 
 * Controls applying and synchronizing edits for a model (and its children) with a remote server using event streams and edit operations. 
 * 
 * The process involves applying an edit to the model and submitting it to the remote server; combined, this is refered to as publishing an edit.
 * To improve UI feedback, edits are first applied to the model and then submitted to the server. The controller will then handle
 * failures (e.g. automatically apply the reverse to rollback the edit).
 * 
 * The controller also manages synchronizing edits by listening for events from the server via event streams. The model
 * has a revision number that is used to help keep it in sync with the server; if at any time the model gets out of
 * sync the controller will fetch missing edits from the server and get it back in sync.
 * 
 * This also supports parent/child relationships via a shared event stream allowing the user of a single event stream
 * to pass events to a model and all it's children.
 */
export abstract class EditController<TModel extends IModel = IModel, TEventStreamData = any, TEventStreamError = any> {
    private readonly editApplied = new EventEmitter<IEditOperation>("edit-applied");
    private readonly handlers: { [editType: string]: EditHandlers<any> } = {};

    private readonly editQueue: IRemoteEditQueue;
    private readonly synchronizer: Synchronizer;
    private readonly channel: IEditChannel;

    /** The model type the controller is responsible for and is expected to be the model type for an edit event. */
    abstract readonly modelType: string;

    constructor(model: TModel, parent: EditController);
    constructor(model: TModel, stream: IEditEventStream<TEventStreamData, TEventStreamError>);
    constructor(readonly model: TModel, streamOrParent: IEditEventStream<TEventStreamData, TEventStreamError> | EditController) {
        if (model.isNew()) {
            throw new Error("Edit controller does not support new models.");
        }

        // use the parent's queue since edit events are expected to come on the same stream
        this.editQueue = streamOrParent instanceof EditController
            ? streamOrParent.editQueue
            : this.createRemoteEditQueue(streamOrParent);

        this.synchronizer = new Synchronizer(
            this.model, 
            (startRevision) => this.fetchEdits(startRevision),
            (edit, revision) => this.applyEdit(edit, revision).then(result => result.success));

        this.channel = this.editQueue.createChannel(
            this,
            () => this.synchronizer.synchronize(),
            edit => this.handleSubmitEdit(edit));
    }

    /** An event that is raised after an edit has been applied to the model. */
    get onEditApplied(): IEvent<IEditOperation> {
        return this.editApplied.event;
    }

    /** Connects to the edit event stream for listening to edits sent by remote source. */
    connectStream(): Promise<IConnectStreamResult> {
        return this.editQueue.connectStream();
    }

    /** Disconnects the edit stream. */
    disconnectStream(): void {
        this.editQueue.disconnect();
    }

    /** Returns a promise to wait for all pending edits to be applied and submitted; note, this will not wait for edits that were received via the stream. */
    waitForAllSubmits(): Promise<void> {
        return this.editQueue.waitForAllSubmits();
    }

    /** Returns a promise to wait for the queue to be completely idle; this will wait for all pending edits to be applied and submitted as well as wait for any received edit events to be processed as well. */
    waitForIdle(): Promise<void> {
        return this.editQueue.waitForIdle();
    }

    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        return this.editQueue.tryWaitForSubmit(edit);
    }

    /** Fetches new edits for the current model starting at the specified revision number. */
    protected abstract fetchEdits(startRevision?: number): Promise<IEditOperation[]>;

    /** 
     * Gets the child controller with the specified model id or undefined if not found. 
     * Note: parent controllers are responsible for handling this logic.
     */
    protected getChildController(modelType: string, modelId: string): EditController | undefined {
        return undefined;
    }

    /** 
     * A custom edit event message handler; return true if the message was handled otherwise false. 
     * This allows the controller to process/handle messages from the stream before applying them
     * to the model. If this returns true, the event will be ignored and not applied to the model.
     * 
     * Note: this will not be invoked by child controllers; only the parent controller.
     */
    protected handleCustomEvent(event: IEditEvent): boolean {
        return false;
    }

    /** Manually apply (but not submit) an edit against the current model and associate the specified revision number. */
    protected applyEdit(edit: IEditOperation, revision: number): Promise<IApplyEditResult> {
        return this.editQueue.applyEdit(this, edit, () => this.synchronizer.synchronize(), revision);
    }

    /** Handles an event received from the stream; the default behavior is to apply the edit to the current model or child model depending on the model type for the event. */
    protected async handleEditEvent(editEvent: IEditEvent): Promise<void> {
        if (this.modelType === editEvent.modelType && this.model.id === editEvent.modelId) {
            // ignore edit unless the revision is greater
            if (this.model.revision < editEvent.revision) {
                // TODO: if the revision is not sequential should this sync instead of apply?
                // TODO: what if the edit fails to apply? force a sync?
                await this.applyEdit(editEvent.edit, editEvent.revision);
            }
        }
        else {
            // if the event is not for the model of the current controller look for a child controller to handle it
            const child = this.getChildController(editEvent.modelType, editEvent.modelId);
            if (child) {
                await child.handleEditEvent(editEvent);
            }
        }
    }

    /** 
     * Applies and submits the specified edit. The returned promise will wait for the published edit to be applied but not submitted; 
     * the result will include another promise that can be used to await the submission if necessary.
     */
    protected publishEdit<TEdit extends IEditOperation = IEditOperation>(edit: TEdit): Promise<IPublishEditResult> {
        return this.channel.createPublisher().publish(edit).then(result => ({
            success: result.success,
            edit: result.edit,
            waitForSubmit: (<IPublishEditContext>result.response).waitForSubmit
        }));
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

        return Promise.resolve(handlers.apply(edit)).then(result => {
            if (isApplyEditHandlerSuccess(result)) {
                this.editApplied.emit(edit);
            }

            return result;
        });
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

    /** Gets a queue for applying and submitting edits while maintaining revision order. */
    private createRemoteEditQueue(stream: IEditEventStream<TEventStreamData, TEventStreamError>): IRemoteEditQueue {
        const root = this;
        return new class implements IRemoteEditQueue {
            private readonly editContexts = new Map<IEditOperation, IPublishEditContext>();
            private readonly submissions = new Set<Promise<ISubmitEditResult>>();
        
            // use a local edit queue to handle queuing async-submission requests and ensure they are
            // published/submitted in order, and with the support of channels edits against different
            // models can be queued and managed separately
            private readonly localQueue: LocalEditQueue;
            private readonly eventQueue: AsyncQueue;
        
            private eventQueuePromise = Promise.resolve();
            private connectPromise?: Promise<IConnectStreamResult>;
            private connection?: IEditEventStreamConnection<TEventStreamData, TEventStreamError>;
            private isClosed = false;
        
            constructor() {
                // TODO: need to handle network connection issues (publish edits regardless...)
                this.localQueue = new LocalEditQueue(edit => this.handleApplyEdit(edit));
                this.eventQueue = new AsyncQueue();
            }

            applyEdit(controller: EditController, edit: IEditOperation, syncModel: SyncModelCallback, revision: number): Promise<IApplyEditResult> {
                // note: we can't rely on controller.model in here because the queue is shared and used by child controllers

                // create a separate channel so that will simply return success for the submission, this will skip the submission step
                const channel = this.createChannel(controller, syncModel, () => Promise.resolve({ success: true, revision }));
                const sync = () => syncModel().then(() => ({ success: false, edit }));
        
                // revisions are expected to be in sequential order; otherwise, force a sync without applying the edit
                if (controller.model.revision + 1 !== revision) {
                    return sync();
                }
        
                return channel.createPublisher().publish(edit).then(async result => {
                    if (result.success) {
                        // if successful wait for the submission (it will always be successful)
                        const submitResult = await (<IPublishEditContext>result.response).waitForSubmit;
                        return { success: submitResult.success, edit, reverse: submitResult.reverse };
                    }
                    
                    // if we fail, attempt to synchronize the model
                    return await sync();
                });
            }
        
            connectStream(): Promise<IConnectStreamResult> {
                if (this.connection) {
                    // the stream is already connected
                    return Promise.resolve({ success: true });
                }

                if (this.isClosed) {
                    throw new Error("The stream has already been closed.");
                }

                if (this.connectPromise) {
                    // already in the process of connecting
                    return this.connectPromise;
                }

                this.connectPromise = stream.openStream().then(connection => {
                    if (!connection.isOpen) {
                        if (!connection.error) {
                            throw new Error("An error is expected when a connection fails.");
                        }

                        return { success: false, error: connection.error };
                    }

                    this.connection = connection;
                    this.connection.onData(data => {
                        // applying an edit is an asynchronous operation so use a queue to process events in order as they are received
                        // also capture the promise so that it can be used to wait for the queue to finish processing events
                        this.eventQueuePromise = this.eventQueue.push(async () => {
                            // give the edit event to the root/parent controller to handle
                            // it is possible the server will send an edit event before the original submit has
                            // had a chance to respond so wait for all pending submissions before processing the event
                            const editEvent = stream.toEditEvent(data);
                            await this.waitForAllSubmits().then(() => root.handleEditEvent(editEvent));
                        });
                    });

                    return { success: true };
                });

                return this.connectPromise;
            }
        
            createChannel(controller: EditController, syncModel: SyncModelCallback, submit: ISubmitEditHandler): IEditChannel {
                return this.localQueue.createChannel({
                    extend: {
                        publisher: publisher => ({
                            publish: edit => {
                                const context = this.savePublishEditContext(controller, edit);
                                // publishing the edit here will apply it locally and if successful we'll then submit it
                                return publisher.publish(edit).then(result => {
                                    if (result.success) {
                                        // the local queue successfully handled the edit but it is possible that the controller failed to apply it
                                        const applyResult = <ApplyResult>result.response;
                                        if (isApplyEditHandlerSuccess(applyResult)) {
                                            // if successful start the submit process
                                            this.submitEdit(context, result.edit, applyResult.reverse, syncModel, submit);
                                        }
                                        else {
                                            context.resolve({ success: false, edit: result.edit, error: applyResult.error });
                                        }
                                    }
                                    else {
                                        // the local queue failed to handle the edit
                                        context.resolve({ success: false, edit: result.edit, error: result.error });
                                    }
                            
                                    // return the context with the result, the reverse edit is only used for the submission
                                    return { ...result, response: context };
                                });
                            }
                        })
                    }
                });
            }
        
            disconnect(): void {
                if (this.connection) {
                    this.connection.close();
                    this.connection = undefined;
                    this.isClosed = true;
                }
            }

            tryWaitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
                const context = this.editContexts.get(edit);
                return context ? context.waitForSubmit : Promise.resolve(undefined);
            }
        
            async waitForAllSubmits(): Promise<void> {
                await Promise.all(Array.from(this.submissions.values()));
            }

            async waitForIdle(): Promise<void> {
                await this.waitForAllSubmits();
                await this.eventQueuePromise;
            }
        
            waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult> {
                return this.getPublishEditContext(edit).waitForSubmit;
            }
        
            private getPublishEditContext(edit: IEditOperation): IPublishEditContext {
                const context = this.editContexts.get(edit);

                if (!context) {
                    throw new Error(`Publish edit context (${edit.type}) not found.`);
                }

                return context;
            }

            private handleApplyEdit(edit: IEditOperation): Promise<ApplyResult> {
                // get the controller from the edit context that needs to handle the edit
                const context = this.getPublishEditContext(edit);
                return context.controller.handleApplyEdit(edit);
            }

            private savePublishEditContext(controller: EditController, edit: IEditOperation): IPublishEditContext {
                let reject!: (err: any) => void;
                let resolve!: (result: ISubmitEditResult) => void;
                // note: the submission will be handled in the background; if it is necessary to wait for the submission to complete use the waitForSubmit function
                const waitForSubmit = this.saveSubmissionPromise(new Promise((res: (value: ISubmitEditResult) => void, rej) => {
                    resolve = res;
                    reject = rej;
                }));
        
                const context: IPublishEditContext = {
                    controller,
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
        
            private async submitEdit(context: IPublishEditContext, edit: IEditOperation, reverse: IEditOperation, syncModel: SyncModelCallback, submit: ISubmitEditHandler): Promise<void> {
                // apply a reverse edit since the published edit has already been applied and then sync the model
                // TODO: how to best handle the error when applying the reverse edit
                const reverseAndSync = (reverse: IEditOperation) => context.controller.handleApplyEdit(reverse)
                    .then(() => syncModel())
                    .catch(() => syncModel());
        
                // if we fail to submit capture the error and reverse
                const result = await submit(edit).catch(error => (<ISubmitEditHandlerFail>{ success: false, error }));
                if (isSubmitEditHandlerSuccess(result)) {
                    // the revision should always move forward
                    if (context.controller.model.revision < result.revision) {
                        // the revision numbers are expected to be sequential; if out of sync, resync the model and 
                        // do not set the revision number, that should be handled by the sync process
                        if (context.controller.model.revision + 1 !== result.revision) {
                            return syncModel()
                                .then(() => context.resolve({ success: true, edit, reverse, data: result.data }))
                                .catch(err => context.reject(err));
                        }

                        context.controller.model.setRevision(result.revision);
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
    }
}