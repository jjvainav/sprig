import { IEditHandler, IEditOperation } from "@sprig/edit-operation";
import { combineHandlers, IAction, IActionHandler, IStore, IStoreExtension, mapHandlers, createStore } from "@sprig/store";

/** An action that applies an edit operation against the state in a store. */
export interface IEditAction extends IAction<IEditOperation[]> {
    readonly type: "edit-operation";
    readonly edit: IEditOperation;
    readonly handler: IEditHandler<any>;
}

export interface IEditStoreOptions<TState, TEdit extends IEditOperation = IEditOperation> {
    readonly initialState: TState;
    readonly editHandler: IEditHandler<TState, TEdit>;
}

export interface IEditStore<TState> extends IStore<TState> {
    dispatchEdit<TEdit extends IEditOperation>(edit: TEdit, handler?: IEditHandler<TState, TEdit>): Promise<IEditOperation[]>;
}

const editActionHandler: IActionHandler<any, IEditOperation[], IEditAction> = (store, action) => {
    let reverse: IEditOperation[] = [];
    store.save(state => {
        let newState: any;
        const ops = action.handler({ save: s => newState = s }, state, action.edit);
        reverse = reverse.concat(ops);
        return newState;
    });
    
    return reverse;
};

export function createEditStore<TState, TEdit extends IEditOperation = IEditOperation>(options: IEditStoreOptions<TState, TEdit>): IEditStore<TState> {
    return createStore({
        ...options,
        handler: editActionHandler
    }, 
    editable(options.editHandler));
}

/** A store extension that adds support for dispatching edit operations against a store. */
export function editable<TState, TEdit extends IEditOperation = IEditOperation>(editHandler: IEditHandler<TState, TEdit>): IStoreExtension<TState, IEditStore<TState>> {
    return factory => (getState, handler) => {
        if (<any>handler !== editActionHandler) {
            handler = combineHandlers(handler, mapHandlers({ ["edit-operation"]: editActionHandler }));
        }
        
        const store = factory(getState, handler);

        return {
            ...store,
            dispatchEdit: <T extends IEditOperation>(edit: T, handler?: IEditHandler<TState, T>) => {
                return store.dispatch<IEditOperation[]>(<IEditAction>{ 
                    type: "edit-operation", 
                    edit: <IEditOperation>edit, 
                    handler: handler || editHandler });
            }
        };
    };
}

export function isEditStore<TState>(store: IStore<TState>): store is IEditStore<TState> {
    return (<IEditStore<TState>>store).dispatchEdit !== undefined;
}