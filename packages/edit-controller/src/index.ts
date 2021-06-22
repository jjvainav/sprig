import { IEditModel, Synchronizer } from "@sprig/edit-model";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue as LocalEditQueue, IEditChannel, IEditDispatchResult } from "@sprig/edit-queue";
import { IEvent } from "@sprig/event-emitter";
import { IEventStreamError, IRequestEventStream } from "@sprig/request-client-events";

/** Defines a callback responsible for synchronizing a model. */
export type SyncModelCallback = () => Promise<void>;

/** Defines the result of applying an edit. */
export interface IApplyEditResult extends IEditDispatchResult {
    // note: in terms of the edit controller dispatching an edit from the local queue is the same as applying the edit to the model
}

/** Defines the result from applying an edit and also includes a promise to wait for the edit to be submitted and synced with the server. */
export interface IApplyEditWithSyncResult extends IApplyEditResult {
    readonly waitForSync: Promise<boolean>;
}

/** Defines options for connecting to an event stream. */
export interface IConnectStreamOptions {
    readonly onError?: (err: IEventStreamError) => void;
    readonly onOpen?: () => void;
}

/** Handles opening a stream of edit events with a remote server. */
export interface IEditEventStream<TEventStreamData = any> {
    /** Opens an event stream for receiving edit events from the server. */
    openStream(): IRequestEventStream<TEventStreamData>;
    /** Converts the data received from the stream to an edit event. */
    toEditEvent(data: TEventStreamData): IEditEvent;
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
export interface IPublishEditResult extends IApplyEditResult {
    readonly waitForSubmit: Promise<ISubmitEditResult | undefined>;
}

/** Provides functions for notifying the outcome of a submission. */
export interface ISubmitEditOutcome {
    /** Signals that the submit was successful and provides the updated revision number for the model with optional response data from the submission. */
    readonly success: (revision: number, data?: any) => void;
    /** Signals that the submit failed and to rollback the edit. */
    readonly fail: () => void;
}

/** Represents the result of a submission. */
export interface ISubmitEditResult {
    readonly success: boolean;
    readonly data?: any;
}

/** A callback responsible for submitting an edit to the server. */
export interface ISubmitEditHandler<TEdit extends IEditOperation = IEditOperation> {
    (edit: TEdit, outcome: ISubmitEditOutcome): void;
}

/** Defines a queue for applying and submitting edits while maintaining revision order. */
interface IRemoteEditQueue {
    /** An event that occurs when an edit has been applied to a model by the queue. */
    readonly onEditApplied: IEvent<IApplyEditResult>;
    /** 
     * Manually applies an edit against the model and associates the specified revision number. The optional response is used to
     * mimic the response from a submission so that users of the controller can still rely on waitForSubmit for edits that
     * were applied locally or via publish. Also note: if isPublic is true, the channel used to apply the edit will raise an
     * onEditApplied event.
     */
    applyEdit(model: IEditModel, edit: IEditOperation, syncModel: SyncModelCallback, revision: number, response?: any, isPublic?: boolean): Promise<IApplyEditWithSyncResult>;
    
    /** Connects the edit queue with a remote server. */
    connect(options?: IConnectStreamOptions): void;
    /** 
     * Creates a channel for publishing and submitting edits for the specified model. Note: if isPrivate is true,
     * edits applied via the channel will not raise the onEditApplied event.
     */
    createChannel(model: IEditModel, syncModel: SyncModelCallback, submit: ISubmitEditHandler, isPrivate?: boolean): IEditChannel;
    /** Disconnects the edit queue from the remote server. */
    disconnect(): void;
    /** Returns a promise that will wait for all submit processes to complete. */
    waitForAllSubmits(): Promise<void>;
    /** Returns a promise to wait for the given edit to be submitted; returns undefined if the edit has already been submitted or a submission was not found. */
    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined>;
}

/** Maintains the state for an edit during the publish/submit process. */
interface IProcessEditContext {
    readonly model: IEditModel;
    readonly waitForSubmit: Promise<ISubmitEditResult>;
    readonly reject: (err: any) => void;
    readonly resolve: (result: ISubmitEditResult) => void;
}

/** 
 * Handles applying and synchronizing edits for an edit model (and its children) with a remote server using event streams. 
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
export abstract class EditEventController<TModel extends IEditModel = IEditModel> {
    private readonly submitHandlers = new Map<string, ISubmitEditHandler<any>>();

    private readonly editQueue: IRemoteEditQueue;
    private readonly synchronizer: Synchronizer;
    private readonly channel: IEditChannel;
    private readonly stream?: IEditEventStream;

    /** The model type the controller is responsible for; is expected to be the model type for an edit event. */
    protected abstract readonly modelType: string;

    constructor(model: TModel, stream: IEditEventStream);
    constructor(model: TModel, parent: EditEventController);
    constructor(readonly model: TModel, parentOrStream: EditEventController | IEditEventStream) {
        if (parentOrStream instanceof EditEventController) {
            this.editQueue = parentOrStream.editQueue;
        }
        else {
            // use the parent's queue since edit events are expected to come on the same stream
            this.editQueue = this.createRemoteEditQueue();
            this.stream = parentOrStream;
        }

        this.synchronizer = new Synchronizer(
            this.model, 
            (_, startRevision) => this.fetchEdits(startRevision),
            (_, edit, revision) => this.applyEdit(edit, revision).then(result => result.success));

        this.channel = this.editQueue.createChannel(
            this.model, 
            () => this.synchronizer.synchronize(),
            (edit, outcome) => {
                const handler = this.submitHandlers.get(edit.type);

                if (!handler) {
                    throw new Error(`Handler not registered for edit (${edit.type}).`);
                }

                handler(edit, outcome);
            });
    }

    /** 
     * An event that is raised when an edit has been applied; note, this only gets raised when edits are 
     * published via a public channel and not manually applied and will also include all edits in the controller hierarchy.
     */
    get onEditApplied(): IEvent<IApplyEditResult> {
        return this.editQueue.onEditApplied;
    }

    /** Connects to the edit stream for listening to edits sent by the server. */
    connectStream(options?: IConnectStreamOptions): void {
        this.editQueue.connect(options);
    }

    /** Disconnects the edit stream. */
    disconnectStream(): void {
        this.editQueue.disconnect();
    }

    waitForAllSubmits(): Promise<void> {
        return this.editQueue.waitForAllSubmits();
    }

    waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
        return this.editQueue.waitForSubmit(edit);
    }

    /** Fetches new edits for the current model starting at the specified revision number. */
    protected abstract fetchEdits(startRevision?: number): Promise<IEditOperation[]>;

    /** 
     * Gets the child controller with the specified model id or undefined if not found. 
     * Note: parent controllers are responsible for handling this logic.
     */
    protected getChildControllerForModel(modelType: string, modelId: string): EditEventController | undefined {
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

    /** 
     * Applies an edit against the current model and associate the specified revision number; this will return false if the revision was not applied. 
     * The optional response object will be passed to the submit result for any handlers. The returned promise will wait for the published edit to be 
     * dispatched/applied but not submitted; the result will include a promise that can be used to await the submission if necessary.
     */
    protected applyEdit(edit: IEditOperation, revision: number, response?: any, isPublic?: boolean): Promise<IApplyEditWithSyncResult> {
        return this.editQueue.applyEdit(this.model, edit, () => this.synchronizer.synchronize(), revision, response, isPublic);
    }

    /** 
     * Publishes and applies the specified edit with an optional submit handler to override the default submit behavior. 
     * The returned promise will wait for the published edit to be dispatched/applied but not submitted; the result will 
     * include a promise that can be used to await the submission if necessary.
     */
    protected publishEdit(edit: IEditOperation): Promise<IPublishEditResult> {
        return this.channel.createPublisher().publish(edit).then(result => ({
            ...result,
            waitForSubmit: this.editQueue.waitForSubmit(edit)
        }));
    }

    /** Registers a handler responsible for submitting a specific type of edit. */
    protected registerSubmitEditHandler<TEdit extends IEditOperation = IEditOperation>(type: string, handler: ISubmitEditHandler<TEdit>): void {
        this.submitHandlers.set(type, handler);
    }

    /** Starts a sync process for the specified model. */
    protected syncModel(): Promise<void> {
        return this.synchronizer.synchronize();
    }

    private openStream(): IRequestEventStream {
        if (!this.stream) {
            throw new Error("Cannot open stream from child controller.");
        }

        return this.stream.openStream();
    }

    private toEditEvent(data: any): IEditEvent {
        if (!this.stream) {
            throw new Error("Edit event stream not available from child controller.");
        }

        return this.stream.toEditEvent(data);
    }

    /** Gets a queue for applying and submitting edits while maintaining revision order. */
    private createRemoteEditQueue(): IRemoteEditQueue {
        const controller = this;
        return new class implements IRemoteEditQueue {
            private readonly editContexts = new WeakMap<IEditOperation, IProcessEditContext>();
            private readonly submissions = new Set<Promise<ISubmitEditResult>>();
        
            // use a local edit queue to handle queuing async-submission requests and ensure they are
            // published/submitted in order, and with the support of channels edits against different
            // models can be queued and managed separately
            private readonly queue: LocalEditQueue;
        
            private stream?: IRequestEventStream;
            private isClosed = false;
        
            constructor() {
                // TODO: need to handle network connection issues (publish edits regardless...)
                this.queue = new LocalEditQueue(this.doApplyEdit.bind(this));
            }
        
            get onEditApplied(): IEvent<IApplyEditResult> {
                return this.queue.onEditDispatched;
            }
        
            applyEdit(model: IEditModel, edit: IEditOperation, syncModel: SyncModelCallback, revision: number, response?: any, isPublic?: boolean): Promise<IApplyEditWithSyncResult> {
                // create and use a private channel (if isPublic is not true) so that the dispatched edits can't be captured via the queue's edit dispatched event
                const channel = this.createChannel(model, syncModel, (_, outcome) => outcome.success(revision, response), /* isPrivate */ !isPublic);
        
                // revisions are expected to be in sequential order; otherwise, force a sync without publishing
                if (model.revision + 1 !== revision) {
                    return Promise.resolve({ 
                        success: false, 
                        edit,
                        channel,
                        waitForSync: syncModel().then(() => true)
                    });
                }
        
                return channel.createPublisher().publish(edit).then(result => {
                    const context = this.getProcessEditContext(edit);
                    if (context.waitForSubmit) {
                        return {
                            ...result,
                            // the submit process will handle syncing the model if the dispatch failed
                            waitForSync: new Promise((resolve, reject) => context.waitForSubmit!
                                .then(r => resolve(r.success))
                                .catch(err => reject(err)))
                        };
                    }
        
                    // if the waitForSubmit promise does not exist that means the dispatch failed
                    return { ...result, waitForSync: Promise.resolve(false) };
                });
            }
        
            connect(options?: IConnectStreamOptions): void {
                // avoid an accidental connection and do not re-connect if disconnect was explicitly called
                if (!this.stream && !this.isClosed) {
                    options = options || {};
                    this.stream = controller.openStream();
    
                    if (options.onOpen) {
                        this.stream.onOpen(options.onOpen);
                    }
                    
                    this.stream.onError(err => {
                        // this will only get invoked if there is an error on the initial connection attempt
                        // once the EventSource is open, it will internally retry to connect when there are network issues
        
                        if (this.stream) {
                            // should be closed but just incase
                            this.stream.close();
                            this.stream = undefined;
                        }
        
                        if (options!.onError) {
                            options!.onError(err);
                        }
                    });
                    this.stream.onMessage(message => {
                        // it is possible the server will send an edit event before the original submit has
                        // had a chance to respond so wait for all pending submissions before processing the event
                        this.waitForAllSubmits().then(() => {
                            // allow the parent controller the ability to handle the message first
                            if (!controller.handleCustomEvent(message.data)) {
                                const editEvent = controller.toEditEvent(message.data);
                                const currentOrChild = this.findController(editEvent.modelType, editEvent.modelId);
            
                                // ignore edits unless the revision is greater
                                if (currentOrChild && currentOrChild.model.revision < editEvent.revision) {
                                    // TODO: if the revision is not sequential should this sync instead of apply?
                                    currentOrChild.applyEdit(editEvent.edit, editEvent.revision);
                                }
                            }
                        });
                    });
                }
            }
        
            createChannel(model: IEditModel, syncModel: SyncModelCallback, submit: ISubmitEditHandler, isPrivate?: boolean): IEditChannel {
                return this.queue.createChannel({
                    isPrivate,
                    extend: {
                        publisher: publisher => ({
                            publish: edit => {
                                const context = this.saveProcessEditContext(model, edit);
                                return publisher.publish(edit).then(result => {
                                    if (result.success) {
                                        // if successful start the submit process
                                        this.submitEdit(context, result, syncModel, submit);
                                    }
                                    else {
                                        // if not resolve the waitForSubmit promise and indicate the submission failed
                                        context.resolve({ success: false });
                                    }
                            
                                    return result;
                                });
                            }
                        })
                    }
                });
            }
        
            disconnect(): void {
                if (this.stream) {
                    this.stream.close();
                    this.stream = undefined;
                    this.isClosed = true;
                }
            }
        
            async waitForAllSubmits(): Promise<void> {
                await Promise.all(Array.from(this.submissions.values()));
            }
        
            waitForSubmit(edit: IEditOperation): Promise<ISubmitEditResult | undefined> {
                const context = this.editContexts.get(edit);
                return context && context.waitForSubmit ? context.waitForSubmit : Promise.resolve(undefined);
            }
        
            private doApplyEdit(edit: IEditOperation): Promise<IEditOperation | undefined> {
                const context = this.getProcessEditContext(edit);
                return Promise.resolve(context.model.apply(edit));
            }
    
            private findController(modelType: string, modelId: string): EditEventController | undefined {
                return controller.modelType === modelType && controller.model.id === modelId
                    ? controller
                    : controller.getChildControllerForModel(modelType, modelId);
            }
        
            private getProcessEditContext(edit: IEditOperation): IProcessEditContext {
                const context = this.editContexts.get(edit);
        
                if (!context) {
                    throw new Error("Edit was published using an unknown channel.");
                }
        
                return context;
            }
        
            private saveProcessEditContext(model: IEditModel, edit: IEditOperation): IProcessEditContext {
                let reject!: (err: any) => void;
                let resolve!: (result: ISubmitEditResult) => void;
                // note: the submission will be handled in the background; if it is necessary to wait for the submission to complete use the waitForSubmit function
                const waitForSubmit = this.saveSubmissionPromise(new Promise((res: (value: ISubmitEditResult) => void, rej) => {
                    resolve = res;
                    reject = rej;
                }));
        
                const context: IProcessEditContext = {
                    model,
                    waitForSubmit,
                    reject,
                    resolve
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
        
            private submitEdit(context: IProcessEditContext, result: IApplyEditResult, syncModel: SyncModelCallback, submit: ISubmitEditHandler): void {
                if (!result.response) {
                    throw new Error("Edit did not provide a reverse.");
                }
        
                const reverse = result.response;
                const reverseAndSync = (reverse: IEditOperation) => {
                    // need to first execute the reverse edit since the published edit has already been applied
                    context.model.apply(reverse);
                    // then sync the model
                    return syncModel();
                };
        
                submit(result.edit, {
                    success: (rev, data) => {
                        if (context.model.revision < rev) {
                            // the revision should always move forward
                            context.model.setRevision(rev);
                        }
                        
                        context.resolve({ success: true, data });
                    },
                    // TODO: need to handle failure because of network not connected
                    fail: () => reverseAndSync(reverse)
                        .then(() => context.resolve({ success: false }))
                        .catch(err => context.reject(err))
                });
            }
        }
    }
}