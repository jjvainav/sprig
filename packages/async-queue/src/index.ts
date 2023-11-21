import { EventEmitter, IEvent } from "@sprig/event-emitter";

/** Defines options for the async queue. */
export interface IAsyncQueueOptions {
    /** True if the queue should process tasks concurrently; otherwise, tasks are processed sequentially. The default is false. */
    readonly isConcurrent?: boolean;
}

export interface IAsyncTask<T> {
    (): Promise<T>;
}

interface IPendingTask {
    start(): void;
}

interface IScheduledTask<T> {
    readonly task: IAsyncTask<T>;
    readonly promise: Promise<T>;
    cancel(): void;
}

interface IQueueScheduler<T> {
    (task: IAsyncTask<T>): IScheduledTask<T>;
}

function createConcurrentScheduler<T>(): IQueueScheduler<T> {
    // TODO: consider support for restricting the number of concurrent tasks at once
    // the cancel function is only necessary when chaining/queuing promises
    return task => ({ task, promise: task(), cancel() { } });
}

function createSequentialScheduler<T>(): IQueueScheduler<T> {
    let next: { readonly promise: Promise<T>, readonly done: () => boolean } = {
        promise: Promise.resolve(<any>undefined),
        done: () => true
    };

    return task => {
        let isCanceled = false;
        let isDone = false;

        const invokeTask = (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => {
            if (isCanceled) {
                // - if canceled just resolve with no value and skip executing the task
                resolve(<any>undefined);
                isDone = true;
            }
            else {
                task()
                    .then(value => {
                        resolve(value);
                        isDone = true;
                    })
                    .catch(err => {
                        reject(err);
                        isDone = true;
                    });
            }
        };

        // add to the chain only if the previous task has not completed
        next = next.done()
            ? { 
                promise: new Promise((resolve, reject) => invokeTask(resolve, reject)), 
                done: () => isDone 
            }
            : {
                promise: new Promise((resolve, reject) => {
                    // invoke the next task regardless of the outcome of the previous task
                    next.promise
                        .then(() => invokeTask(resolve, reject))
                        .catch(() => invokeTask(resolve, reject));
                }),
                done: () => isDone
            };
        
        return {
            task,
            promise: next.promise,
            cancel: () => isCanceled = true
        };
    };
}

/** Provides support for queuing and processing async tasks. */
export class AsyncQueue<T = void> {
    private readonly idle = new EventEmitter("queue-idle");
    private readonly tasks = new Set<IScheduledTask<T>>();
    private readonly scheduler: IQueueScheduler<T>;
    private pending?: IPendingTask[];

    private _isAborted = false;

    constructor(options?: IAsyncQueueOptions) {
        this.scheduler = options && options.isConcurrent ? createConcurrentScheduler() : createSequentialScheduler();
    }

    get onIdle(): IEvent {
        return this.idle.event;
    }

    get isAborted(): boolean {
        return this._isAborted;
    }

    get isIdle(): boolean {
        return !this.tasks.size;
    }

    get isPaused(): boolean {
        return !!this.pending;
    }

    /** 
     * Aborts any processing/queued items and prevents queued items from being executed. 
     * Once aborted the queue will no longer accept tasks.
     */
    abort(): void {
        this._isAborted = true;
        this.tasks.forEach(task => task.cancel());
    }

    /** Returns true if there are pending tasks when the queue is paused. Note, if the queue is paused it will most likely also be idle. */
    hasPendingTasks(): boolean {
        return !!this.pending && !!this.pending.length;
    }

    /** Causes the queue to queue tasks but pause scheduling until resumed. */
    pause(): void {
        this.pending = this.pending || [];
    }

    push(task: IAsyncTask<T>): Promise<T> {
        if (this._isAborted) {
            throw new Error("The queue has been aborted");
        }

        const schedule = () => this.add(this.scheduler(task)).promise;
        if (this.pending) {
            return new Promise((resolve, reject) => {
                this.pending!.push({
                    start: () => schedule()
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                });
            });
        }

        return schedule();
    }

    /** Resumes all pending tasks that have been queued while paused. */
    resume(): void {
        if (this.pending) {
            this.pending.forEach(task => task.start());
            this.pending = undefined;
        }
    }

    waitForIdle(): Promise<void> {
        return this.isIdle ? Promise.resolve() : new Promise(resolve => {
            this.onIdle.once(() => resolve());
        });
    }

    private add(task: IScheduledTask<T>): IScheduledTask<T> {
        this.tasks.add(task);
        task.promise.then(() => this.onTaskFinished(task)).catch(() => this.onTaskFinished(task));
        return task;
    }

    private onTaskFinished(task: IScheduledTask<T>): void {
        if (this.tasks.delete(task) && !this.tasks.size) {
            this.idle.emit();
        }
    }
}