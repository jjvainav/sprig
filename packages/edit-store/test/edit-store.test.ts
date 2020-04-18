import { createScopedHandler, defineScope, IEditHandler, IEditOperation } from "@sprig/edit-operation";
import { createEditStore } from "../src";

interface IItem {
    readonly id: string;
    readonly value: string;
}

interface IState {
    readonly items: IItem[];
}

interface IUpdateItem extends IEditOperation {
    readonly type: "item.update";
    readonly itemId: string;
    readonly value: string;
}

const itemScope = defineScope<IState, IItem, IUpdateItem>("items", edit => ({ id: edit.itemId }));

const handleUpdateItem: IEditHandler<IItem, IUpdateItem> = (context, model, edit) => {
    context.save({ ...model, value: edit.value });
    return updateItem(edit.itemId, model.value);
};

function updateItem(itemId: string, value: string): IUpdateItem {
    return { type: "item.update", itemId, value };
}

describe("edit store", () => {
    test("dispatch edit with registered handler", async () => {
        const initialState: IState = { 
            items: [{ id: "1", value: "Hello" }] 
        };

        const store = createEditStore({
            initialState,
            editHandler: createScopedHandler(handleUpdateItem, itemScope)
        });

        const reverse = await store.dispatchEdit(updateItem("1", "World"));

        expect(reverse).toBeDefined();

        const state = store.getState();
        expect(state.items).toHaveLength(1);
        expect(state.items[0].value).toBe("World");
    });

    test("dispatch edit with explicit handler", async () => {
        const initialState: IState = { 
            items: [{ id: "1", value: "Hello" }] 
        };

        const store = createEditStore({
            initialState,
            editHandler: () => { throw new Error("Not implemented") }
        });

        const handler = createScopedHandler(handleUpdateItem, itemScope);
        const reverse = await store.dispatchEdit(updateItem("1", "World"), handler);

        expect(reverse).toBeDefined();

        const state = store.getState();
        expect(state.items).toHaveLength(1);
        expect(state.items[0].value).toBe("World");
    });

    test("dispatch edit with scoped handler", async () => {
        const initialState: IState = { 
            items: [{ id: "1", value: "Hello" }] 
        };

        const store = createEditStore({
            initialState,
            editHandler: createScopedHandler(handleUpdateItem, itemScope)
        });

        const reverse = await store.dispatchEdit(updateItem("1", "World"));

        expect(reverse).toBeDefined();

        const state = store.getState();
        expect(state.items).toHaveLength(1);
        expect(state.items[0].value).toBe("World");
    });
});