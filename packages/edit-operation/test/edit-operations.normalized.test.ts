import { Collection, ICollection } from "@sprig/immutable-collection";
import { applySplitter, createMappedHandler, createScopedHandler, defineScope, IEditHandler, IEditOperation } from "../src";

// A set of tests against a normalized data structure (e.g. flattened)
// These were created because normalized data structures require a different strategy when editing

type ListEditOperations = IAddTodo | ICreateList | IDeleteList | IRemoveTodo | IUpdateListName;
type ItemEditOperations = ICreateTodo | IDeleteTodo | IUpdateTodoCompleted;

interface ITodoState {
    readonly lists: Collection<ITodoList>;
    readonly items: Collection<ITodoItem>;
}

interface ITodoList {
    readonly id: string;
    readonly name: string;
    readonly todos: string[];
}

interface ITodoItem {
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
}

interface IAddTodo extends IEditOperation {
    readonly type: "list.add";
    readonly listId: string;
    readonly todoId: string;
}

interface IRemoveTodo extends IEditOperation {
    readonly type: "list.remove";
    readonly listId: string;
    readonly todoId: string;
}

interface ICreateList extends IEditOperation {
    readonly type: "list.create";
    readonly listId: string;
    readonly name: string;
    readonly todos: string[];
}

interface IDeleteList extends IEditOperation {
    readonly type: "list.delete";
    readonly listId: string;
}

interface IUpdateListName extends IEditOperation {
    readonly type: "list.name";
    readonly listId: string;
    readonly name: string;
}

interface ICreateTodo extends IEditOperation {
    readonly type: "todo.create";
    readonly todoId: string;
    readonly title: string;
    readonly completed: boolean;
}

interface IDeleteTodo extends IEditOperation {
    readonly type: "todo.delete";
    readonly todoId: string;
}

interface IUpdateTodoCompleted extends IEditOperation {
    readonly type: "todo.completed";
    readonly todoId: string;
    readonly completed: boolean;
}

const todoListCollectionScope = defineScope<ITodoState, ICollection<ITodoList>>("lists");
const todoListScope = defineScope<ITodoState, ITodoList, ListEditOperations>("lists", edit => ({ id: edit.listId }));

const todoItemCollectionScope = defineScope<ITodoState, ICollection<ITodoItem>>("items");
const todoItemScope = defineScope<ITodoState, ITodoItem, ItemEditOperations>("items", edit => ({ id: edit.todoId }));

const handleAddTodo: IEditHandler<ITodoList, IAddTodo> = (context, model, edit) => {
    context.save({ 
        ...model, 
        todos: [...model.todos, edit.todoId]
    });

    return removeTodo(edit.listId, edit.todoId);
};

const handleRemoveTodo: IEditHandler<ITodoList, IRemoveTodo> = (context, model, edit) => {
    context.save({ 
        ...model, 
        todos: model.todos.filter(id => id !== edit.todoId)
    });

    return addTodo(edit.listId, edit.todoId);
};

const handleCreateList: IEditHandler<ICollection<ITodoList>, ICreateList> = (context, model, edit) => {
    context.save(model.insert({  
        id: edit.listId,
        name: edit.name,
        todos: edit.todos
    }));

    return deleteList(edit.listId);
};

const handleDeleteList: IEditHandler<ICollection<ITodoList>, IDeleteList> = (context, model, edit) => {
    const list = model.find({ id: edit.listId })!;
    context.save(model.delete({ id: edit.listId }));
    return createList(list.id, list.name, list.todos);    
};

const handleDeleteListAndChildren: IEditHandler<ITodoState, IDeleteList> = (context, model, edit) => {
    const list = model.lists.find({ id: edit.listId })!;
    const reverse: IEditOperation[] = [createList(list.id, list.name, list.todos)];

    let newState = {
        ...model,
        lists: model.lists.delete({ id: edit.listId })
    };

    for (const id of list.todos) {
        const item = model.items.find({ id })!;

        newState = {
            ...newState,
            items: newState.items.delete({ id })
        };

        reverse.push(createTodo(id, item.title, item.completed));
    }

    context.save(newState);

    return reverse;   
};

const handleUpdateListName: IEditHandler<ITodoList, IUpdateListName> = (context, model, edit) => {
    context.save({ ...model!, name: edit.name });
    return updateListName(edit.listId, model.name);
};

const handleCreateTodo: IEditHandler<ICollection<ITodoItem>, ICreateTodo> = (context, model, edit) => {
    context.save(model.insert({
        id: edit.todoId,
        title: edit.title,
        completed: edit.completed
    }));

    return deleteTodo(edit.todoId);
};

const handleDeleteTodo: IEditHandler<ICollection<ITodoItem>, IDeleteTodo> = (context, model, edit) => {
    const todo = model.find({ id: edit.todoId })!;
    context.save(model.delete({ id: edit.todoId }));
    return createTodo(edit.todoId, todo.title, todo.completed);
}

const handleUpdateTodoCompleted: IEditHandler<ITodoItem, IUpdateTodoCompleted> = (context, model, edit) => {
    context.save({ ...model, completed: edit.completed });
    return updateTodoCompleted(edit.todoId, !edit.completed);
};

function createList(listId: string, name: string, todos: string[]): ICreateList {
    return { type: "list.create", listId, name, todos };
}

function deleteList(listId: string): IDeleteList {
    return { type: "list.delete", listId };
}

function addTodo(listId: string, todoId: string): IAddTodo {
    return { type: "list.add", listId, todoId };
}

function removeTodo(listId: string, todoId: string): IRemoveTodo {
    return { type: "list.remove", listId, todoId };
}

function createTodo(todoId: string, title: string, completed: boolean): ICreateTodo {
    return { type: "todo.create", todoId, title, completed };
}

function deleteTodo(todoId: string): IDeleteTodo {
    return { type: "todo.delete", todoId };
}

function updateListName(listId: string, name: string): IUpdateListName {
    return { type: "list.name", listId, name };
}

function updateTodoCompleted(todoId: string, completed: boolean): IUpdateTodoCompleted {
    return { type: "todo.completed", todoId, completed };
}

describe("edit operation - normalized", () => {
    test("edit object with array scoped handler", () => {
        const edit = updateTodoCompleted("T1", true);
        const handler = createScopedHandler(handleUpdateTodoCompleted, todoItemScope);
        const original = {
            lists: new Collection([{ id: "L1", name: "test", todos: ["T1", "T2"] }]),
            items: new Collection([
                { id: "T1", title: "todo 1", completed: false },
                { id: "T2", title: "todo 2", completed: false }
            ])
        };

        let newModel: ITodoState | undefined;
        handler({ save: model => newModel = model }, original, edit);

        expect(newModel!.items.count()).toBe(2);
        expect(newModel!.items.find({ id: "T1" })!.completed).toBeTruthy();
    });

    test("edit object with mapped handler", () => {
        const handler = createMappedHandler<ITodoState, ListEditOperations | ItemEditOperations>({
            "list.add": createScopedHandler(handleAddTodo, todoListScope),
            "list.create": createScopedHandler(handleCreateList, todoListCollectionScope),
            "list.delete": createScopedHandler(handleDeleteList, todoListCollectionScope),
            "list.name": createScopedHandler(handleUpdateListName, todoListScope),
            "list.remove": createScopedHandler(handleRemoveTodo, todoListScope),
            "todo.completed": createScopedHandler(handleUpdateTodoCompleted, todoItemScope),
            "todo.create": createScopedHandler(handleCreateTodo, todoItemCollectionScope),
            "todo.delete": createScopedHandler(handleDeleteTodo, todoItemCollectionScope)
        });

        let model: ITodoState = {
            lists: new Collection([{ id: "L1", name: "test", todos: [] }]),
            items: new Collection()
        };

        const context = { save: (newModel: ITodoState) => { model = newModel } };

        handler(context, model, updateListName("L1", "my list"));
        handler(context, model, createTodo("T1", "todo 1", false));
        handler(context, model, addTodo("L1", "T1"));
        handler(context, model, createTodo("T2", "todo 2", false));
        handler(context, model, addTodo("L1", "T2"));
        handler(context, model, updateTodoCompleted("T1", true));
        handler(context, model, updateTodoCompleted("T2", true)); 
        handler(context, model, removeTodo("L1", "T1"));
        handler(context, model, deleteTodo("T1"));

        const list = model.lists.find({ id: "L1" });
        expect(model.lists.count()).toBe(1);
        expect(list).toBeDefined();
        expect(list!.name).toBe("my list");
        expect(list!.todos).toHaveLength(1);

        const item = model.items.find({ id: "T2" });
        expect(model.items.count()).toBe(1);
        expect(item).toBeDefined();
        expect(item!.completed).toBeTruthy();
    });

    test("delete composite object with single handler", () => {
        // This tests a strategy for deleting an object that contains a collection of
        // references to other objects that exist in a different collection using
        // a single edit handler.

        let model: ITodoState = {
            lists: new Collection([
                { id: "L1", name: "list 1", todos: ["T1", "T3"] },
                { id: "L2", name: "list 2", todos: ["T2"] }
            ]),
            items: new Collection([
                { id: "T1", title: "todo 1", completed: false },
                { id: "T2", title: "todo 2", completed: false },
                { id: "T3", title: "todo 3", completed: false }
            ])
        };

        handleDeleteListAndChildren({ save: newModel => model = newModel }, model, deleteList("L1"));

        expect(model.lists.count()).toBe(1);
        expect(model.items.count()).toBe(1);
    });

    test("delete composite object with combined handlers", () => {
        // This tests a strategy for deleting an object that contains a collection of
        // references to other objects that exist in a different collection using a splitter.

        const handler = applySplitter<ITodoState, IDeleteList | IDeleteTodo, IDeleteList>(createMappedHandler({
            "list.delete": createScopedHandler(handleDeleteList, todoListCollectionScope),
            "todo.delete": createScopedHandler(handleDeleteTodo, todoItemCollectionScope)
        }), {
            "list.delete": (model, edit) => {
                const list = model.lists.find({ id: edit.listId })!;
                return list.todos.reduce((acc, cur) => acc.concat(deleteTodo(cur)), <(IDeleteList | IDeleteTodo)[]>[edit]);
            }
        });

        let model: ITodoState = {
            lists: new Collection([
                { id: "L1", name: "list 1", todos: ["T1", "T3"] },
                { id: "L2", name: "list 2", todos: ["T2"] }
            ]),
            items: new Collection([
                { id: "T1", title: "todo 1", completed: false },
                { id: "T2", title: "todo 2", completed: false },
                { id: "T3", title: "todo 3", completed: false }
            ])
        };

        const reverse = <IEditOperation[]>handler({ save: newModel => model = newModel }, model, deleteList("L1"));

        expect(reverse).toHaveLength(3);

        expect(model.lists.count()).toBe(1);
        expect(model.items.count()).toBe(1);
    });

    test("delete referenced object with combined handlers", () => {
        // This tests a strategy for deleting an object that is referenced by another object in 
        // a different collection using a splitter.

        const handler = applySplitter<ITodoState, IDeleteList | IDeleteTodo | IRemoveTodo, IDeleteTodo>(createMappedHandler({
            "list.delete": createScopedHandler(handleDeleteList, todoListCollectionScope),
            "list.remove": createScopedHandler(handleRemoveTodo, todoListScope),
            "todo.delete": createScopedHandler(handleDeleteTodo, todoItemCollectionScope)
        }), {
            "todo.delete": (model, edit) => {
                const lists = model.lists.findAll({ todos: edit.todoId });
                return lists.reduce((acc, cur) => acc.concat(removeTodo(cur.id, edit.todoId)), <(IDeleteList | IDeleteTodo | IRemoveTodo)[]>[edit]);
            }
        });

        let model: ITodoState = {
            lists: new Collection([
                { id: "L1", name: "list 1", todos: ["T1", "T3"] },
                { id: "L2", name: "list 2", todos: ["T2"] },
                { id: "L3", name: "list 3", todos: ["T3"] }
            ]),
            items: new Collection([
                { id: "T1", title: "todo 1", completed: false },
                { id: "T2", title: "todo 2", completed: false },
                { id: "T3", title: "todo 3", completed: false }
            ])
        };

        const reverse = <IEditOperation[]>handler({ save: newModel => model = newModel }, model, deleteTodo("T3"));

        expect(reverse).toHaveLength(3);

        expect(model.lists.count()).toBe(3);
        expect(model.lists.find({ id: "L1" })!.todos).toHaveLength(1);
        expect(model.lists.find({ id: "L2" })!.todos).toHaveLength(1);
        expect(model.lists.find({ id: "L3" })!.todos).toHaveLength(0);

        expect(model.items.count()).toBe(2);
    });
});