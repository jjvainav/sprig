import { applySplitter, combineScopes, createMappedHandler, createScopedHandler, defineScope, IEditContext, IEditHandler, IEditOperation } from "../src";

type EditOperations = ICreateTodo | IDeleteTodo | IUpdateListName | IUpdateTodoCompleted;

interface ITodoRoot {
    readonly manager: ITodoManager;
}

interface ITodoManager {
    readonly list: ITodoList;
}

interface ITodoList {
    readonly id: string;
    readonly name: string;
    readonly todos: ITodoItem[];
}

interface ITodoItem {
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
}

interface ICompositeEdit extends IEditOperation {
    readonly type: "composite";
    readonly data: {
        readonly edits: EditOperations[];
    };
}

interface IUpdateListName extends IEditOperation {
    readonly type: "list.name";
    readonly data: {
        readonly listId: string;
        readonly name: string;
    };
}

interface ICreateTodo extends IEditOperation {
    readonly type: "todo.create";
    readonly data: {
        readonly id: string;
        readonly title: string;
        readonly completed: boolean;
    };
}

interface IDeleteTodo extends IEditOperation {
    readonly type: "todo.delete";
    readonly data: {
        readonly id: string;
    };
}

interface IUpdateTodoCompleted extends IEditOperation {
    readonly type: "todo.completed";
    readonly data: {
        readonly todoId: string;
        readonly completed: boolean;
    };
}

const todoListScope = defineScope<ITodoManager, ITodoList>("list");
const todoItemScope = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));

const handleUpdateListName: IEditHandler<ITodoList, IUpdateListName> = (context, model, edit) => {
    context.save({ ...model, name: edit.data.name });
    return updateListName(edit.data.listId, model.name);
};

const handleCreateTodo: IEditHandler<ITodoList, ICreateTodo> = (context, model, edit) => {
    context.save({
        ...model,
        todos: [...model.todos, {
            id: edit.data.id,
            title: edit.data.title,
            completed: edit.data.completed
        }]
    });

    return deleteTodo(edit.data.id);
};

const handleDeleteTodo: IEditHandler<ITodoList, IDeleteTodo> = (context, model, edit) => {
    context.save({
        ...model,
        todos: model.todos.filter(todo => todo.id !== edit.data.id)
    });

    const todo = model.todos.filter(todo => todo.id === edit.data.id)[0];
    return createTodo(edit.data.id, todo.title, todo.completed);
}

const handleUpdateTodoCompleted: IEditHandler<ITodoItem, IUpdateTodoCompleted> = (context, model, edit) => {
    context.save({ ...model, completed: edit.data.completed });
    return updateTodoCompleted(edit.data.todoId, !edit.data.completed);
};

function createTodo(id: string, title: string, completed: boolean): ICreateTodo {
    return { 
        type: "todo.create", 
        data: { id, title, completed }
    };
}

function deleteTodo(id: string): IDeleteTodo {
    return { 
        type: "todo.delete", 
        data: { id }
    };
}

function updateListName(listId: string, name: string): IUpdateListName {
    return { 
        type: "list.name", 
        data: { listId, name }
    };
}

function updateTodoCompleted(todoId: string, completed: boolean): IUpdateTodoCompleted {
    return { 
        type: "todo.completed", 
        data: { todoId, completed }
    };
}

describe("edit handler extensions", () => {
    test("apply splitter to mapped handler", () => {
        const handler = applySplitter<ITodoList, EditOperations, ICompositeEdit>(createMappedHandler({
            "list.name": handleUpdateListName,
            "todo.completed": createScopedHandler(handleUpdateTodoCompleted, todoItemScope),
            "todo.create": handleCreateTodo,
            "todo.delete": handleDeleteTodo
        }), {
            "composite": (model, edit) => edit.data.edits
        });

        let model: ITodoList = {
            id: "1",
            name: "test",
            todos: [] 
        };

        const context: IEditContext<ITodoList> = {
            save: newModel => model = newModel
        };

        handler(context, model, updateListName("1", "my list"));
        handler(context, model, {
            type: "composite",
            data: {
                edits: [
                    createTodo("1", "todo 1", false),
                    createTodo("2", "todo 2", false),
                    updateTodoCompleted("1", true),
                    deleteTodo("2")
                ]
            }
        });

        expect(model.name).toBe("my list");
        expect(model.todos).toHaveLength(1);
        expect(model.todos[0].id).toBe("1");
        expect(model.todos[0].completed).toBeTruthy();
    });
});

describe("edit scope", () => {
    test("get object from simple object scope", () => {
        const scope = defineScope<ITodoManager, ITodoList>("list");
        const model = {
            list: {
                id: "1",
                name: "test",
                todos: [
                    { id: "1", title: "todo 1", completed: false },
                    { id: "2", title: "todo 2", completed: false }
                ] 
            }
        };

        const result = scope.get(model, { type: "", data: {} });

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(model.list);
    });

    test("get object from simple array scope", () => {
        const scope = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const model = {
            id: "1",
            name: "test",
            todos: [
                { id: "1", title: "todo 1", completed: false },
                { id: "2", title: "todo 2", completed: false }
            ] 
        };

        const result = scope.get(model, updateTodoCompleted("2", true));

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(model.todos[1]);
    });

    test("get object from simple array scope with multiple matches", () => {
        const scope = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const model = {
            id: "1",
            name: "test",
            todos: [
                { id: "1", title: "todo 1", completed: false },
                { id: "1", title: "todo 1 copy", completed: false }
            ] 
        };

        const result = scope.get(model, updateTodoCompleted("1", true));

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(model.todos[0]);
        expect(result[1]).toBe(model.todos[1]);
    });

    test("get object from combined scope", () => {
        const outer = defineScope<ITodoManager, ITodoList>("list");
        const inner = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const scope = combineScopes(outer, inner);
        const model = {
            list: {
                id: "1",
                name: "test",
                todos: [
                    { id: "1", title: "todo 1", completed: false },
                    { id: "2", title: "todo 2", completed: false }
                ] 
            }
        };

        const result = scope.get(model, updateTodoCompleted("2", true));

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(model.list.todos[1]);
    });

    test("save object with simple object scope", () => {
        const scope = defineScope<ITodoManager, ITodoList>("list");
        const model = {
            list: {
                id: "1",
                name: "test",
                todos: [
                    { id: "1", title: "todo 1", completed: false },
                    { id: "2", title: "todo 2", completed: false }
                ] 
            }
        };

        const result = scope.save(model, { type: "", data: {} }, item => ({ ...item, name: "foo" }));

        expect(result).not.toBe(model);
        expect(result.list.name).toBe("foo");
    });

    test("save object with simple array scope", () => {
        const scope = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const model = {
            id: "1",
            name: "test",
            todos: [
                { id: "1", title: "todo 1", completed: false },
                { id: "2", title: "todo 2", completed: false }
            ] 
        };

        const edit = updateTodoCompleted("2", true);
        const result = scope.save(model, edit, item => ({ ...item, completed: true }));

        expect(result).not.toBe(model);
        expect(result.todos[1].completed).toBeTruthy();
    });

    test("save object with simple array scope with multiple matches", () => {
        const scope = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const model = {
            id: "1",
            name: "test",
            todos: [
                { id: "1", title: "todo 1", completed: false },
                { id: "1", title: "todo 1 copy", completed: false }
            ] 
        };

        const edit = updateTodoCompleted("1", true);
        const result = scope.save(model, edit, item => ({ ...item, completed: true }));

        expect(result).not.toBe(model);
        expect(result.todos[0].title).toBe("todo 1");
        expect(result.todos[0].completed).toBeTruthy();
        expect(result.todos[1].title).toBe("todo 1 copy");
        expect(result.todos[1].completed).toBeTruthy();
    });

    test("save object with combined scope", () => {
        const outer = defineScope<ITodoManager, ITodoList>("list");
        const inner = defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId }));
        const scope = combineScopes(outer, inner);
        const model = {
            list: {
                id: "1",
                name: "test",
                todos: [
                    { id: "1", title: "todo 1", completed: false },
                    { id: "2", title: "todo 2", completed: false }
                ] 
            }
        };

        const edit = updateTodoCompleted("2", true);
        const result = scope.save(model, edit, item => ({ ...item, completed: true }));

        expect(result).not.toBe(model);
        expect(result.list.todos[1].completed).toBeTruthy();
    });

    test("save object with multiple combined scope", () => {
        const scope = combineScopes(
            defineScope<ITodoRoot, ITodoManager>("manager"),
            defineScope<ITodoManager, ITodoList>("list"), 
            defineScope<ITodoList, ITodoItem, IUpdateTodoCompleted>("todos", edit => ({ id: edit.data.todoId })));
        const model = {
            manager: {
                list: {
                    id: "1",
                    name: "test",
                    todos: [
                        { id: "1", title: "todo 1", completed: false },
                        { id: "2", title: "todo 2", completed: false }
                    ] 
                }
            }
        };

        const edit = updateTodoCompleted("2", true);
        const result = scope.save(model, edit, item => ({ ...item, completed: true }));

        expect(result).not.toBe(model);
        expect(result.manager.list.todos[1].completed).toBeTruthy();
    });
});

describe("edit operation - rational", () => {
    test("edit object with object scoped handler", () => {
        const edit = updateListName("1", "my list");
        const handler = createScopedHandler(handleUpdateListName, todoListScope);
        const original = {
            list: {
                id: "1",
                name: "test",
                todos: []
            }
        };

        let newModel: ITodoManager;
        handler({ save: model => newModel = model }, original, edit);

        expect(newModel!.list.name).toBe("my list");
    });

    test("edit object with array scoped handler", () => {
        const edit = updateTodoCompleted("1", true);
        const handler = createScopedHandler(handleUpdateTodoCompleted, todoItemScope);
        const original = {
            id: "1",
            name: "test",
            todos: [
                { id: "1", title: "todo 1", completed: false },
                { id: "2", title: "todo 2", completed: false }
            ] 
        };

        let newModel: ITodoList;
        handler({ save: model => newModel = model }, original, edit);

        expect(newModel!.todos).toHaveLength(2);
        expect(newModel!.todos[0].completed).toBeTruthy();
    });

    test("edit object with composite scoped handler", () => {
        const edit = updateTodoCompleted("1", true);
        const handler = createScopedHandler(handleUpdateTodoCompleted, todoListScope, todoItemScope);
        const original = {
            list: {
                id: "1",
                name: "test",
                todos: [
                    { id: "1", title: "todo 1", completed: false },
                    { id: "2", title: "todo 2", completed: false }
                ] 
            }
        };

        let newModel: ITodoManager;
        handler({ save: model => newModel = model }, original, edit);

        expect(newModel!.list.todos).toHaveLength(2);
        expect(newModel!.list.todos[0].completed).toBeTruthy();
    });

    test("edit object with mapped handler", () => {
        const handler = createMappedHandler<ITodoList, EditOperations>({
            "list.name": handleUpdateListName,
            "todo.completed": createScopedHandler(handleUpdateTodoCompleted, todoItemScope),
            "todo.create": handleCreateTodo,
            "todo.delete": handleDeleteTodo
        });

        let model: ITodoList = {
            id: "1",
            name: "test",
            todos: [] 
        };

        const context: IEditContext<ITodoList> = {
            save: newModel => model = newModel
        };

        handler(context, model, updateListName("1", "my list"));
        handler(context, model, createTodo("1", "todo 1", false));
        handler(context, model, createTodo("2", "todo 2", false));
        handler(context, model, updateTodoCompleted("1", true));
        handler(context, model, updateTodoCompleted("2", true)); 
        handler(context, model, deleteTodo("1"));

        expect(model.name).toBe("my list");
        expect(model.todos).toHaveLength(1);
        expect(model.todos[0].id).toBe("2");
        expect(model.todos[0].completed).toBeTruthy();
    });
});