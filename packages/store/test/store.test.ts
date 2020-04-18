import { combineHandlers, createStore, IAction, IActionHandler, IStore, IStoreOptions, mapHandlers } from "../src";

interface IItem {
    readonly id: string;
    readonly value: string;
}

interface IState {
    readonly items: IItem[];
}

interface IAddItem extends IAction {
    readonly type: "add-item";
    readonly itemId: string;
    readonly value: string;
}

interface IUpdateItem extends IAction {
    readonly type: "update-item";
    readonly itemId: string;
    readonly value: string;
}

const getItem = (state: IState) => (id: string) => {
    for (const item of state.items) {
        if (item.id === id) {
            return item;
        }
    }

    return undefined;
};

const handler = mapHandlers({
    "add-item": addItemHandler,
    "update-item": updateItemHandler
});

function createTestStore(options?: IStoreOptions<IState>): IStore<IState> {
    return createStore(options || { initialState: { items: [] }, handler });
}

function addItemAction(itemId: string, value: string): IAction {
    return <IAddItem>{ type: "add-item", itemId, value };
}

function updateItemAction(itemId: string, value: string): IAction {
    return <IUpdateItem>{ type: "update-item", itemId, value };
}

function addItemHandler(store: IStore<IState>, action: IAddItem): void {
    store.save(state => ({
        ...state,
        items: [...state.items, { id: action.itemId, value: action.value }]
    }));
}

function updateItemHandler(store: IStore<IState>, action: IUpdateItem): void {
    const item = store.select(getItem, action.itemId);

    if (!item) {
        throw new Error("Item not found");
    }

    if (item.value === action.value) {
        return;
    }

    store.save(state => ({
        ...state,
        cart: update(state.items, { id: action.itemId, value: action.value })
    }));
}

describe("store", () => {
    test("dispatch action", async () => {
        const store = createTestStore();
        const oldState = store.getState();

        await store.dispatch(addItemAction("1", "foo"));

        const newState = store.getState();
        expect(oldState).not.toBe(newState);
    });

    test("dispatch multiple actions", async () => {
        const store = createTestStore();
        let count = 0;

        store.onChanged(() => count++);

        await store.dispatch(addItemAction("1", "foo"));
        await store.dispatch(addItemAction("2", "bar"));

        expect(count).toBe(2);
    });

    test("dispatch action that does not change state", async () => {
        const store = createTestStore();
        let count = 0;

        store.onChanged(() => count++);

        await store.dispatch(addItemAction("1", "foo"));
        await store.dispatch(updateItemAction("1", "foo"));
        await store.dispatch(updateItemAction("1", "foo"));

        expect(count).toBe(1);
    });

    test("dispatch invalid action", async () => {
        const store = createTestStore();
        const oldState = store.getState();

        let flag = false;
        store.onChanged(() => flag = true);
        
        await expect(store.dispatch(updateItemAction("1", "foo"))).rejects.toThrow();

        const newState = store.getState();
        expect(flag).toBeFalsy();
        expect(oldState).toBe(newState);
    });

    test("combine handlers", async () => {
        const actions: IAction[] = [];
        const customHandler: IActionHandler<IState> = (_, action) => {
            actions.push(action);
            return Promise.resolve();
        };
        const store = createTestStore({
            initialState: { items: [] },
            handler: combineHandlers(customHandler, handler)
        });

        await store.dispatch(addItemAction("1", "foo"));

        expect(actions).toHaveLength(1);
    });
});

function update<T extends { id: string }>(array: T[], item: T): T[] {
    let index = -1;

    for (let i = 0; i < array.length; i++) {
        if (array[i].id === item.id) {
            index = i;
            break;
        }
    }

    if (index < 0) {
        return [...array, item];
    }

    const result = array.slice(0);
    result[index] = item;
    return result;
}