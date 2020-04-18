import { EventEmitter, IEvent } from "@sprig/event-emitter";

export type Dispatch = <TResult, TAction extends IAction<TResult>>(action: TAction) => Promise<TResult>;

export interface IAction<TResult = void> {
    readonly type: string;
}

export interface IActionHandler<TState, TResult = void, TAction extends IAction<TResult> = IAction<TResult>> {
    (store: IStore<TState>, action: TAction): TResult | Promise<TResult>;
}

export interface ISelector<TState, TResult, TArgs extends any[]> {
    (state: TState): (...args: TArgs) => TResult;
}

export interface IStoreFactory<TState, TStore extends IStore<TState>> {
    (getState: () => TState, handler: IActionHandler<TState>): TStore;
}

export interface IStoreExtension<TState, TStore extends IStore<TState>> {
    (factory: IStoreFactory<TState, IStore<TState>>): IStoreFactory<TState, TStore>;
}

export interface IStoreOptions<TState> {
    readonly handler: IActionHandler<TState, any, any>;
    readonly initialState: TState;
}

export interface IStore<TState> {
    /** An event that is raised when the state of the store has changed. */
    readonly onChanged: IEvent;
    /** Dispatches an action against the store. */
    dispatch<TResult>(action: IAction<TResult>): Promise<TResult>;
    /**
     * Attempts to select data from the store and dispatches a fetch action if the data does not exist.
     * The fetch action is intended to fetch data from an external source and save it back to the store
     * when the select fails.
     *
     * Example:
     * const product = await store.fetch(createFetchProductAction, productSelector, action.productId);
     */
    fetch<TResult, TArgs extends any[]>(createFetchAction: (...args: TArgs) => IAction<TResult>, selector: ISelector<TState, TResult, TArgs>, ...args: TArgs): Promise<TResult>;
    /** Gets a snapshot of the current state in the store. */
    getState(): TState;
    /** Provide a callback to receive the current snapshot of the state in the store and return an updated snapshot to save back into the store. */
    save(callback: (state: TState) => TState): void;
    /** Provide a selector callback that will filter and return a section of the current state. */
    select<TResult, TArgs extends any[]>(selector: ISelector<TState, TResult, TArgs>, ...args: TArgs): TResult;
}

export function createStore<TState>(options: IStoreOptions<TState>): IStore<TState>;
export function createStore<TState, A extends IStore<TState>>(options: IStoreOptions<TState>, extensionA: IStoreExtension<TState, A>): IStore<TState> & A;
export function createStore<TState, A extends IStore<TState>, B extends IStore<TState>>(options: IStoreOptions<TState>, extensionA: IStoreExtension<TState, A>, extensionB: IStoreExtension<TState, B>): IStore<TState> & A & B;
export function createStore<TState>(options: IStoreOptions<TState>, ...extensions: IStoreExtension<TState, IStore<TState>>[]): IStore<TState> {
    let state = options.initialState;
    
    const changed = new EventEmitter("store-changed");
    const setState = (newState: TState) => {
        if (state !== newState) {
            state = newState;
            changed.emit();
        }
    };

    let factory: IStoreFactory<TState, IStore<TState>> = (getState, handler) => {
        return { 
            onChanged: changed.event,
            dispatch: function (action) {
                return new Promise(resolve => resolve(<any>handler(this, action)));
            },
            fetch: function (createFetchAction, selector, ...args) {
                return fetch(this, createFetchAction(...args), selector, args);
            },
            getState,
            save: function (callback) { 
                setState(callback(getState()));
            },
            select: function (selector, ...args) {
                return selector(this.getState())(...args);
            }
        };
    };

    if (extensions) {
        extensions.forEach(extension => factory = extension(factory));
    }
    
    return factory(() => state, options.handler);
}

export function combineHandlers<TState>(...handlers: IActionHandler<TState, any, any>[]): IActionHandler<TState, any, any> {
    return (store, action) => {
        // map to all handlers; a handler is expected to ignore the action if it does not handle it
        return Promise.all(handlers.map(handler => handler(store, action)))
            .then(result => {
                // filter out all the 'undefined' values that get returned because of the promise.all
                result = result.filter(value => value !== undefined);

                if (result.length === 1) {
                    return result[0];
                }

                if (result.length > 1) {
                    throw new Error("Multiple handlers returned a result");
                }

                return undefined;
            });
    };
}

export function mapHandlers<TState>(handlers: { [type in string]: IActionHandler<TState, any, any> }): IActionHandler<TState, any, any> {
    return (store, action) => {
        const handler = <IActionHandler<any>>(<any>handlers)[action.type];
        return handler ? handler(store, action) : Promise.resolve();
    };
}

async function fetch<TState, TResult, TArgs extends any[]>(store: IStore<TState>, fetchAction: IAction<TResult>, selector: ISelector<TState, TResult, TArgs>, args: TArgs): Promise<TResult> {
    const result = selector(store.getState())(...args);
    return result || await store.dispatch(fetchAction);
}