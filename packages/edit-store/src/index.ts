import { IEditOperation } from "@sprig/edit-operation";
import { Collection, Filter, ICollection } from "@sprig/immutable-collection";
import { combineHandlers, IAction, IActionHandler, IStore, IStoreExtension, mapHandlers, createStore } from "@sprig/store";

type StringKeys<T> = Extract<keyof T, string>;
export type ArrayPropertyNames<TAggregate, TModel> = { [K in keyof TAggregate]: TAggregate[K] extends Array<TModel> ? K : never }[StringKeys<TAggregate>];
export type CollectionPropertyNames<TAggregate, TModel> = { [K in keyof TAggregate]: TAggregate[K] extends ICollection<TModel> ? K : never }[StringKeys<TAggregate>];
export type ObjectPropertyNames<TAggregate, TModel> = { [K in keyof TAggregate]: TAggregate[K] extends TModel ? K : never }[StringKeys<TAggregate>];

type EditTypeNames<TEdit extends IEditOperation> = Pick<TEdit, "type">["type"];
type PickEditByType<TEdit extends IEditOperation, TType extends string> = TEdit extends IEditOperation & { readonly type: TType } ? TEdit : never;
export type EditHandlerMap<TModel, TEdit extends IEditOperation> = { [P in EditTypeNames<TEdit>]: IEditHandler<TModel, PickEditByType<TEdit, P>> };
export type EditSplitterMap<TModel, TEdit extends IEditOperation, TEditToSplit extends IEditOperation> = { [P in EditTypeNames<TEditToSplit>]: IEditSplitter<TModel, TEdit, PickEditByType<TEditToSplit, P>> };

/** An action that applies an edit operation against the state in a store. */
export interface IEditAction extends IAction<IEditOperation[]> {
    readonly type: "edit-operation";
    readonly edit: IEditOperation;
    readonly handler: IEditHandler<any>;
}

export interface IEditContext<TModel> {
    save(model: TModel): void;
}

/** Handles an edit operation and returns one or more reverse edits. */
export interface IEditHandler<TModel, TEdit extends IEditOperation = IEditOperation> {
    (context: IEditContext<TModel>, model: TModel, edit: TEdit): IEditOperation | IEditOperation[];
}

export interface IEditScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation> {
    get(aggregate: TAggregate, edit: TEdit): TModel[];
    save(aggregate: TAggregate, edit: TEdit, callback: (model: TModel) => TModel): TAggregate;
}

/** Handles splitting an edit into one or more individual edits for processing. */
export interface IEditSplitter<TModel, TEdit extends IEditOperation = IEditOperation, TEditToSplit extends IEditOperation = TEdit> {
    (model: TModel, edit: TEditToSplit): TEdit[];
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

export function combineEditHandlers<TModel, TEdit extends IEditOperation>(...handlers: IEditHandler<TModel, TEdit>[]): IEditHandler<TModel, TEdit> {
    return (context, model, edit) => {
        const reverse: IEditOperation[] = [];
        const push = (edits: IEditOperation | IEditOperation[]) => {
            if (Array.isArray(edits)) {
                reverse.push(...edits);
            }
            else {
                reverse.push(edits);
            }
        };

        let result = model;
        handlers.forEach(handler => push(handler({ save: newModel => result = newModel }, result, edit)));

        context.save(result);

        return reverse;
    };
}

/** 
 * Splits an edit into one or more edits for handling; the TEditToSplit is expected to be split into TEdit where TEdit can be multiple edits using a Union. 
 * The provided handler is then responsible for handling the split edits.
 */
export function applySplitter<TModel, TEdit extends IEditOperation, TEditToSplit extends IEditOperation = TEdit>(handler: IEditHandler<TModel, TEdit>, splitter: EditSplitterMap<TModel, TEdit, TEditToSplit>): IEditHandler<TModel, TEdit | TEditToSplit> {
    return (context, model, edit) => {
        const split = (<any>splitter)[edit.type];

        if (!split) {
            return handler(context, model, <TEdit>edit);
        }    

        let newModel = model;
        const result = (<TEdit[]>split(model, edit)).reduce((acc, cur) => {
            return acc.concat(handler({ save: m => newModel = m }, newModel, cur));
        }, <IEditOperation[]>[]);

        context.save(newModel);

        return result;
    };
}

export function createMappedHandler<TModel, TEdit1 extends IEditOperation>(map1: EditHandlerMap<TModel, TEdit1>): IEditHandler<TModel, TEdit1>;
export function createMappedHandler<TModel, TEdit1 extends IEditOperation, TEdit2 extends IEditOperation>(map1: EditHandlerMap<TModel, TEdit1>, map2: EditHandlerMap<TModel, TEdit2>): IEditHandler<TModel, TEdit1 & TEdit2>;
export function createMappedHandler<TModel, TEdit1 extends IEditOperation, TEdit2 extends IEditOperation, TEdit3 extends IEditOperation>(map1: EditHandlerMap<TModel, TEdit1>, map2: EditHandlerMap<TModel, TEdit2>, map3: EditHandlerMap<TModel, TEdit3>): IEditHandler<TModel, TEdit1 & TEdit2 & TEdit3>;
export function createMappedHandler<TModel, TEdit1 extends IEditOperation, TEdit2 extends IEditOperation, TEdit3 extends IEditOperation, TEdit4 extends IEditOperation>(map1: EditHandlerMap<TModel, TEdit1>, map2: EditHandlerMap<TModel, TEdit2>, map3: EditHandlerMap<TModel, TEdit3>, map4: EditHandlerMap<TModel, TEdit4>): IEditHandler<TModel, TEdit1 & TEdit2 & TEdit3 & TEdit4>;
export function createMappedHandler<TModel, TEdit extends IEditOperation>(...maps: EditHandlerMap<TModel, TEdit>[]): IEditHandler<TModel, TEdit> {
    const map = maps.reduce((acc, cur) => {
        for (const key in cur) {
            if (cur.hasOwnProperty(key)) {
                (<any>acc)[key] = (<any>cur)[key];
            }
        }

        return acc;
    }, {});

    return (context, model, edit) => {
        const handler = (<any>map)[edit.type];
        return handler ? handler(context, model, edit) : [];
    };
}

export function createScopedHandler<TEdit extends IEditOperation, TAggregate, T1>(handler: IEditHandler<T1, TEdit>, scope1: IEditScope<TAggregate, T1, TEdit>): IEditHandler<TAggregate, TEdit>;
export function createScopedHandler<TEdit extends IEditOperation, TAggregate, T1, T2>(handler: IEditHandler<T2, TEdit>, scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>): IEditHandler<TAggregate, TEdit>;
export function createScopedHandler<TEdit extends IEditOperation, TAggregate, T1, T2, T3>(handler: IEditHandler<T3, TEdit>, scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>, scope3: IEditScope<T2, T3, TEdit>): IEditHandler<TAggregate, TEdit>;
export function createScopedHandler<TEdit extends IEditOperation, TAggregate, T1, T2, T3, T4>(handler: IEditHandler<T3, TEdit>, scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>, scope3: IEditScope<T2, T3, TEdit>, scope4: IEditScope<T3, T4, TEdit>): IEditHandler<TAggregate, TEdit>;
export function createScopedHandler<TEdit extends IEditOperation, TAggregate, T>(handler: IEditHandler<T, TEdit>, ...scopes: IEditScope<any, any>[]): IEditHandler<TAggregate, TEdit> {
    const scope: IEditScope<any, any, any> = combineScopes.apply(null, <any>scopes);
    return (context, aggregate, edit) =>{
        const reverse: IEditOperation[] = [];

        context.save(scope.save(aggregate, edit, model => {
            let result: any;
            const ops = handler({ save: newModel => result = newModel }, model, edit);
            
            if (Array.isArray(ops)) {
                reverse.push(...ops);
            }
            else {
                reverse.push(ops);
            }

            return result;
        }));

        return reverse;
    };
}

export function combineScopes<TEdit extends IEditOperation, TAggregate, T1, T2>(scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>): IEditScope<TAggregate, T2, TEdit>;
export function combineScopes<TEdit extends IEditOperation, TAggregate, T1, T2, T3>(scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>, scope3: IEditScope<T2, T3, TEdit>): IEditScope<TAggregate, T3, TEdit>;
export function combineScopes<TEdit extends IEditOperation, TAggregate, T1, T2, T3, T4>(scope1: IEditScope<TAggregate, T1, TEdit>, scope2: IEditScope<T1, T2, TEdit>, scope3: IEditScope<T2, T3, TEdit>, scope4: IEditScope<T3, T4, TEdit>): IEditScope<TAggregate, T4, TEdit>;
export function combineScopes<TEdit extends IEditOperation, TAggregate>(...scopes: IEditScope<any, any, any>[]): IEditScope<TAggregate, any, TEdit> {
    return scopes.reduce((acc, cur) => ({
        get: (aggregate, edit) => acc.get(aggregate, edit).reduce((result, model) => result.concat(cur.get(model, edit)), []),
        save: (aggregate, edit, callback) => acc.save(aggregate, edit, model => cur.save(model, edit, callback))
    }));
}

export function defineScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation>(prop: ObjectPropertyNames<TAggregate, TModel>): IEditScope<TAggregate, TModel, TEdit>;
export function defineScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation>(prop: ArrayPropertyNames<TAggregate, TModel>, filter: (edit: TEdit) => Filter<TModel>): IEditScope<TAggregate, TModel, TEdit>;
export function defineScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation>(prop: CollectionPropertyNames<TAggregate, TModel>, filter: (edit: TEdit) => Filter<TModel>): IEditScope<TAggregate, TModel, TEdit>;
export function defineScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation>(prop: ObjectPropertyNames<TAggregate, TModel> | ArrayPropertyNames<TAggregate, TModel> | CollectionPropertyNames<TAggregate, TModel>, filter?: (edit: TEdit) => Filter<TModel>): IEditScope<TAggregate, TModel, TEdit> {
    return filter ? defineFilterScope(prop, filter) : defineObjectScope(prop);
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

function defineFilterScope<TAggregate, TModel, TEdit extends IEditOperation = IEditOperation>(prop: string, filter: (edit: TEdit) => Filter<TModel>): IEditScope<TAggregate, TModel, TEdit> {
    return {
        get: (aggregate, edit) => {
            const obj = (<any>aggregate)[prop];
            return Array.isArray(obj)
                ? new Collection<TModel>(obj).findAll(filter(edit))
                : (<ICollection<TModel>>obj).findAll(filter(edit));
        },
        save: (aggregate, edit, callback) => {
            let result = aggregate;
            let obj = (<any>result)[<string>prop];
    
            if (Array.isArray(obj)) {
                const collection = new Collection<TModel>(obj).update(filter(edit), callback);
                result = { ...result, [prop]: collection.toArray() };
            }
            else {
                result = { ...result, [prop]: (<ICollection<TModel>>obj).update(filter(edit), callback) };
            }
    
            return result;
        }
    }
}

function defineObjectScope<TAggregate, TModel>(prop: string): IEditScope<TAggregate, TModel> {
    return {
        get: (aggregate) => [(<any>aggregate)[prop]],
        save: (aggregate, edit, callback) => ({ ...aggregate, [prop]: callback((<any>aggregate)[prop]) })
    };
}