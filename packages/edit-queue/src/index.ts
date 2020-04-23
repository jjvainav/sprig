import { AsyncQueue } from "@sprig/async-queue";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { IEditOperation } from "@sprig/edit-operation";

/** Defines an object responsible for consuming and dispatching edits from the queue for execution. */
export interface IEditDispatcher {
    (edit: IEditOperation): Promise<IEditOperation[]>;
}

export interface IEditPublishingEvent {
    readonly channel: IEditChannel;
    readonly edit: IEditOperation;
    cancel(): void;
}

export interface IEditPublishedEvent {
    readonly channel: IEditChannel;
    readonly edit: IEditOperation;
}

export interface IEditsPublishedEvent {
    readonly channel: IEditChannel;
    readonly edits: IEditOperation[];
    readonly reverse: IEditOperation[];
}

export interface IEditTransactionStartEvent {
    readonly id: number;
}

export interface IEditTransactionEndEvent {
    readonly result: IEditTransactionResult;
}

export interface IEditTransactionResult {
    readonly id: number;
    readonly isAborted: boolean;
    readonly isCommitted: boolean;
    readonly edits: IEditOperation[];
    readonly reverse: IEditOperation[];
}

export interface IEditTransactionScope {
    (transaction: IEditTransaction): Promise<void>;
}

export interface IEditTransaction {
    /** An event that is raised when the transaction has completed. */
    readonly onCompleted: IEvent<IEditTransactionEndEvent>;
    /** A unique id associated with the transaction. */
    readonly id: number;
    /** Gets whether or not the transaction has successfully been committed. */
    readonly isCommitted: boolean;
    /** Gets whether or not the transaction is active, i.e. the transaction is still expecting edits to be published. */
    readonly isActive: boolean;
    /** Gets whether or not the transaction is waiting on pending edits to complete before finalizing/ending the transaction */
    readonly isFinalizing: boolean;
    /** Gets whether or not the transaction has been finalized, i.e. the transaction is no longer active and all pending edits have been processed. */
    readonly isFinalized: boolean;

    /**
     * Publishes an edit to the current transaction.
     * @param edit An edit to publish.
     */
    publish(edit: IEditOperation): Promise<void>;

    /** 
     * Ends the transaction and commits all published edits unless any failed, if an edit failed the transaction will be rolled back. 
     * @param reject Reject the transaction and rollback any edits; the default is false. 
     */
    end(): Promise<IEditTransactionResult>;
    end(reject: boolean): Promise<IEditTransactionResult>;
}

export interface IEditQueueEvents {
    /** An event that gets raised when an edit is about to be published to the queue. */
    readonly onPublishingEdit: IEvent<IEditPublishingEvent>;

    /** An event that gets raised when edits have been successfully published. */
    readonly onPublishedEdits: IEvent<IEditsPublishedEvent>;

    /** 
     * An event that gets raised when an edit has been successfully published. This is a helper event 
     * that splits the results of onPublishedEdits into individual events for each published edit.
     */
    readonly onPublishedEdit: IEvent<IEditPublishedEvent>;
}

export interface IEditQueue extends IEditQueueEvents {
    createChannel(): IEditChannel;
}

export interface IEditChannel extends IEditQueueEvents {
    readonly onTransactionStarted: IEvent<IEditTransactionStartEvent>;
    readonly onTransactionEnded: IEvent<IEditTransactionEndEvent>;
    /** Creates and starts a new transaction that allows bulk edits to be published as a single transaction. */
    beginTransaction(): IEditTransaction;
    /** Closes the current channel. */
    close(): void;
    publish(edits: IEditOperation | IEditOperation[]): Promise<IEditTransactionResult>;
    publish(scope: IEditTransactionScope): Promise<IEditTransactionResult>;
}

interface IProcessedEditEvent {
    readonly edit: IEditOperation;
}

export class EditQueue implements IEditQueue {
    private readonly publishingEdit = new EventEmitter<IEditPublishingEvent>("edits-publishing");
    private readonly publishedEdits = new EventEmitter<IEditsPublishedEvent>("edits-published");

    private readonly channels = new Set<IEditChannel>();
    private publishedEdit?: IEvent<IEditPublishedEvent>;

    constructor(private readonly dispatcher: IEditDispatcher) {
    }

    get onPublishedEdits(): IEvent<IEditsPublishedEvent> {
        return this.publishedEdits.event;
    }

    get onPublishingEdit(): IEvent<IEditPublishingEvent> {
        return this.publishingEdit.event;
    }

    get onPublishedEdit(): IEvent<IEditPublishedEvent> {
        if (!this.publishedEdit) {
            this.publishedEdit = this.publishedEdits.event.split(event => event.edits
                .map(edit => [{ channel: event.channel, edit }])
                .reduce((prev, cur) => cur.concat(prev), []));
        }
        
        return this.publishedEdit;
    }

    createChannel(): IEditChannel {
        const queue = this;
        return new class implements IEditChannel {
            private readonly transactionStarted = new EventEmitter<IEditTransactionStartEvent>("transaction-started");
            private readonly transactionEnded = new EventEmitter<IEditTransactionEndEvent>("transaction-ended");

            /*
             * Edits inside a channel are expected to be executed sequentially but since they are async
             * a couple of queues are needed to manage this expectation. First, there is a queue to 
             * handle long-running transactions (owned by the channel) and then each transaction has
             * it's own queue for the edits.
             */

            private queue = new EditTransactionQueue();
            
            constructor() {
                queue.channels.add(this);
            }

            get onTransactionStarted(): IEvent<IEditTransactionStartEvent> {
                return this.transactionStarted.event;
            }

            get onTransactionEnded(): IEvent<IEditTransactionEndEvent> {
                return this.transactionEnded.event;
            }

            get onPublishingEdit(): IEvent<IEditPublishingEvent> {
                return queue.onPublishingEdit.filter(event => event.channel === this);
            }

            get onPublishedEdits(): IEvent<IEditsPublishedEvent> {
                return queue.onPublishedEdits.filter(event => event.channel === this);
            }

            get onPublishedEdit(): IEvent<IEditPublishedEvent> {
                return queue.onPublishedEdit.filter(event => event.channel === this);
            }

            close(): void {
                queue.channels.delete(this);
            }

            beginTransaction(): IEditTransaction {
                const transaction = new EditTransactionContext(this, queue.dispatcher);

                transaction.onPublishingEdit(event => queue.publishingEdit.emit(event));
                transaction.onFinalized(event => {
                    if (event.result.isCommitted) {
                        queue.publishedEdits.emit({ 
                            channel: this, 
                            edits: event.result.edits,
                            reverse: event.result.reverse
                        });
                    }

                    this.transactionEnded.emit({ result: event.result });
                });

                transaction.stop();

                this.queue.push(transaction, transaction => {
                    transaction.start();
                    this.transactionStarted.emit({ id: transaction.id });
                });

                return transaction;
            }
            
            publish(editsOrScope: IEditOperation | IEditOperation[] | IEditTransactionScope): Promise<IEditTransactionResult> {
                return new Promise((resolve, reject) => {
                    const transaction = this.beginTransaction();
                    const completed = transaction.onCompleted.once(event => resolve(event.result));
                    
                    if (typeof editsOrScope === "function") {
                        editsOrScope(transaction)
                            .then(() => transaction.end())
                            .catch(reason => { 
                                completed.remove();
                                transaction.end(/* reject */ true);
                                reject(reason);
                            })
                    }
                    else {
                        if (Array.isArray(editsOrScope)) {
                            editsOrScope.forEach(edit => transaction.publish(edit));
                        }
                        else {
                            transaction.publish(editsOrScope);
                        }

                        transaction.end();
                    }
                });
            }
        };
    }
}

/** Provides long-running transaction support for dispatched edits. */
class EditTransactionContext implements IEditTransaction {
    private static nextId = 1;

    // used internally to resolve a transaction publish promise
    private readonly processedEdit = new EventEmitter<IProcessedEditEvent>("processed-edit");
    private readonly publishingEdit = new EventEmitter<IEditPublishingEvent>("publishing-edit");

    // note: there are 3 events that get raised when a transaction is completed and are raised in the following order
    // 1) finalizing - used internally by the transaction queue
    // 2) completed - gets exposed through the public API
    // 3) finalized - used internally by the edit channel 
    private readonly completed = new EventEmitter<IEditTransactionEndEvent>("transaction-completed");
    private readonly finalizing = new EventEmitter<IEditTransactionEndEvent>("transaction-finalizing");
    private readonly finalized = new EventEmitter<IEditTransactionEndEvent>("transaction-finalized");

    private readonly edits: IEditOperation[] = [];
    private readonly reverse: IEditOperation[] = [];

    private readonly queue: EditDispatchQueue;
    private readonly pending: IEditOperation[] = [];

    private finalize?: () => void;

    private _isActive = true;
    private _isCommitted = false;
    private isRunning = false;
    private hasFailedEdit = false;

    readonly id: number;
    
    constructor(
        private readonly channel: IEditChannel,
        private readonly dispatcher: IEditDispatcher) {
        this.id = EditTransactionContext.nextId++;
        this.queue = this.createPublishQueue();
    }
    
    get onPublishingEdit(): IEvent<IEditPublishingEvent> {
        return this.publishingEdit.event;
    }

    get onCompleted(): IEvent<IEditTransactionEndEvent> {
        return this.completed.event;
    }

    get onFinalizing(): IEvent<IEditTransactionEndEvent> {
        return this.finalizing.event;
    }

    get onFinalized(): IEvent<IEditTransactionEndEvent> {
        return this.finalized.event;
    }

    /** Gets whether or not the transaction has successfully been committed. */
    get isCommitted(): boolean {
        return this._isCommitted;
    }

    /** Gets whether or not the transaction is active, i.e. the transaction is still expecting edits to be published. */
    get isActive(): boolean {
        return this._isActive;
    }

    /** Gets whether or not the transaction is waiting on pending edits to complete before finalizing/ending the transaction */
    get isFinalizing(): boolean {
        return !this.isActive && this.finalize !== undefined;
    }

    /** Gets whether or not the transaction has been finalized, i.e. the transaction is no longer active and all pending edits have been processed. */
    get isFinalized(): boolean {
        return !this.isActive && this.finalize === undefined;
    }

    end(reject = false): Promise<IEditTransactionResult> {
        if (!this.isActive) {
            return Promise.reject(new Error("Transaction has already ended"));
        }

        return new Promise(resolve => {
            this._isActive = false;
            this.finalize = () => {
                if (!this.queue.isIdle) {
                    throw new Error("Queue is still processing edits");
                }

                // wrap the callback so the on-completion handling logic can process the result first
                const wrap = (result: IEditTransactionResult) => {
                    this.finalizing.emit({ result });
                    this.completed.emit({ result });
                    this.finalized.emit({ result });
                    resolve(result);
                };
                
                if (this.hasFailedEdit || reject) {
                    this.onRollback(wrap);
                }
                else {
                    this.onCommit(wrap);
                }
            };

            if (this.queue.isIdle && !this.pending.length) {
                // the queue is idle and there are no pending edits so the transaction can be finalized immediately
                this.doFinalize();
            }
        });
    }
    
    publish(edit: IEditOperation): Promise<void> {
        if (!this.isActive) {
            throw new Error("The transaction has closed");
        }
        
        if (this.isRunning) {
            this.queue.push(edit);
        }
        else {
            this.pending.push(edit);
        }

        // note: the promise is to provide a way to await a publish when necessary and is
        // not intended to be used for error processing, failed transaction information
        // is provided via one of the finalize events
        return new Promise(resolve => {
            this.processedEdit.event.filter(event => event.edit === edit).once(() => resolve());
        });
    }

    start(): void {
        this.isRunning = true;
        while (this.pending.length) {
            this.queue.push(this.pending.shift()!);
        }
    }

    stop(): void {
        this.isRunning = false;
    }

    private createPublishQueue(): EditDispatchQueue {
        const queue = new EditDispatchQueue(
            this.dispatcher,
            edit => {
                this.publishingEdit.emit({ channel: this.channel, edit, cancel: queue.abort.bind(queue) });
            },
            (edit, reverse) => {
                this.processedEdit.emit({ edit });
                this.edits.push(edit);
                this.reverse.push(...reverse);
            },
            (edit, reason) => {
                this.hasFailedEdit = true;
                this.processedEdit.emit({ edit });
            },
            () => {
                if (!this.isActive) {
                    // getting here means the transaction has ended but edits were still queued for dispatch;
                    // the queue has now become idle so it is safe to finalize the transaction
                    this.doFinalize();
                }
            });

        return queue;
    }
    
    private doFinalize(): void {
        if (!this.finalize) {
            throw new Error("Finalize not defined");
        }
        
        this.finalize();
        this.finalize = undefined;
    }
    
    private onCommit(callback: (result: IEditTransactionResult) => void): void {
        this._isCommitted = true;
        callback({
            id: this.id,
            isAborted: false,
            isCommitted: true,
            edits: this.edits,
            reverse: this.reverse
        });
    }

    private onRollback(callback: (result: IEditTransactionResult) => void): void {
        if (!this.reverse.length) {
            callback({
                id: this.id,
                isAborted: true,
                isCommitted: false,
                edits: this.edits,
                reverse: this.reverse
            });

            return;
        }

        const rollbackQueue = new EditDispatchQueue(
            this.dispatcher,
            () => { },
            edit => {
                console.log("rollback - success:", (<Object>edit).constructor.name);
            },
            (edit, reason) => {
                // TODO: what if a reverse edit fails?
                console.log("rollback - failed:", (<Object>edit).constructor.name, reason);
            },
            // once the queue has gone idle all the reverse edits have been processed
            () => callback({
                id: this.id,
                isAborted: true,
                isCommitted: false,
                edits: this.edits,
                reverse: this.reverse
            }));

        // fill the queue with all the captured reverse edits - the queue will start processing as soon as the edits are pushed
        for (let i = this.reverse.length - 1; i >= 0; i--) {
            rollbackQueue.push(this.reverse[i]);
        }
    }
}

/** Handles queuing transactions for a channel. */
class EditTransactionQueue {
    private readonly queue = new AsyncQueue<void>();
    private readonly transactions: EditTransactionContext[] = [];
    
    push(transaction: EditTransactionContext, start: (transaction: EditTransactionContext) => void): void {
        this.transactions.push(transaction);
        this.queue.push(() => {
            // start the transaction, note: it is possible that the transaction is no longer active but
            // has pending edits, starting the transaction will allow it to handle any pending edits
            start(transaction);

            return new Promise(resolve => {
                transaction.onFinalizing(() => {
                    this.transactions.shift();
                    resolve();
                });
            });
        });
    }
}

/** Handles queuing edits for dispatch. */
class EditDispatchQueue {
    private readonly queue = new AsyncQueue<void>();

    constructor(
        private readonly dispatcher: IEditDispatcher,
        private readonly onPublishingEdit: (edit: IEditOperation) => void,
        private readonly onDispatchResult: (edit: IEditOperation, reverse: IEditOperation[]) => void,
        private readonly onDispatchError: (edit: IEditOperation, reason: any) => void,
        onIdle: () => void) {
        this.queue.onIdle(() => onIdle());
    }

    get isIdle(): boolean {
        return this.queue.isIdle;
    }
    
    abort(): void {
        this.queue.abort();
    }

    push(edit: IEditOperation): void {
        this.queue.push(() => this.dispatch(edit));
    }

    private dispatch(edit: IEditOperation): Promise<void> {
        this.onPublishingEdit(edit);

        if (this.queue.isAborted) {
            // check if the onPublishingEdit callback had triggered the queue to be aborted
            return Promise.resolve();
        }

        return this.dispatcher(edit)
            .then(result => this.onDispatchResult(edit, result))
            .catch(reason => this.onDispatchError(edit, reason));
    }
}