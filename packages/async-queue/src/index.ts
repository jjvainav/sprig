import { EventEmitter, IEvent } from "@sprig/event-emitter";

export interface IAsyncTask<T> {
    (): Promise<T>;
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
    let next: { readonly promise: Promise<T>, readonly done: () => boolean };

    return task => {
        let isCanceled = false;
        let isDone = false;

        const start = async (resolve: (value: T | PromiseLike<T>) => void) => {
            // - the await is so that the task is be completed before flagging as done
            // - if canceled just resolve with no value and skip executing the task
            isCanceled ? resolve(<any>undefined) : resolve(await task());
            isDone = true;
        };

        // add to the chain only if the previous task has not completed
        next = next === undefined || next.done()
            ? { promise: new Promise(resolve => start(resolve)), done: () => isDone }
            : {
                promise: new Promise(resolve => {
                    // start the next task regardless of the outcome of the previous task
                    next.promise.then(() => start(resolve));
                    next.promise.catch(() => start(resolve));
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

    private _isAborted = false;

    constructor(isConcurrent = false) {
        this.scheduler = !isConcurrent ? createSequentialScheduler() : createConcurrentScheduler();
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

    /** 
     * Aborts any processing/queued items and prevents queued items from being executed. 
     * Once aborted the queue will no longer accept tasks.
     */
    abort(): void {
        this._isAborted = true;
        this.tasks.forEach(task => task.cancel());
    }

    push(task: IAsyncTask<T>): Promise<T> {
        if (this._isAborted) {
            throw new Error("The queue has been aborted");
        }

        return this.add(this.scheduler(task)).promise;
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