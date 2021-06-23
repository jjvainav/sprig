import { IEditOperation } from "@sprig/edit-operation";
import { Model, IModel, IModelValidation } from "@sprig/model";
import { createValidation } from "@sprig/model-zod";
import * as zod from "zod";
import { ApplyResult, EditController, IEditEventStream, IPublishEditResult, SubmitResult } from "../src";



// TODO: decouple event stream and instead have a generic event?
// TODO: update the apply edit handler to return an IApplyEditResult
// -- this would contain a reverse edit if successful
// -- support returning a value indicating the apply was not successful
// -- if not successful attempt to sync the model in the controller
// TODO: delete the edit-model package



type Mutable<T> = { -readonly[P in keyof T]: T[P] };

interface IEditRecord {
    readonly modelId: string;
    readonly modelType: string;
    readonly edit: IEditOperation;
    readonly revision: number;
}

/** Used to initialize a test model. */
interface ITestAttributes {
    readonly id: string;
    readonly foo?: string;
    readonly bar?: string;
    readonly children?: IChildModel[];
    readonly items: string[];
    readonly revision: number;
}

/** Used to initialize a child model. */
interface IChildAttributes {
    readonly id: string;
    readonly value: string;
    readonly revision: number;
}

/** A child object returned from the mock API. */
interface IChild {
    readonly id: string;
    readonly value: string;
    readonly revision: number; 
}

interface ITestModel extends IModel<ITestAttributes>, ITestAttributes {
    foo?: string;
    bar?: string;

    addChild(child: IChildModel): void;
    addItem(item: string): void;
    removeChild(id: string): IChildModel | undefined;
    removeItem(item: string): string | undefined;
}

interface IChildModel extends IModel<IChildAttributes>, IChildAttributes {
    value: string;
}

interface IAddChild extends IEditOperation {
    readonly type: "addChild";
    readonly data: {
        readonly childId: string;
    };
}

interface IAddItem extends IEditOperation {
    readonly type: "addItem";
    readonly data: {
        readonly item: string;
    };
}

interface IRemoveChild extends IEditOperation {
    readonly type: "removeChild";
    readonly data: {
        readonly childId: string;
    };
}

interface IRemoveItem extends IEditOperation {
    readonly type: "removeItem";
    readonly data: {
        readonly item: string;
    };
}

interface IUpdateTest extends IEditOperation {
    readonly type: "update";
    readonly data: {
        readonly foo?: string;
        readonly bar?: string;
    };
}

interface IUpdateChild extends IEditOperation {
    readonly type: "update";
    readonly data: {
        readonly value: string;
    };
}

class TestModel extends Model<ITestAttributes> implements ITestModel {
    foo?: string;
    bar?: string;
    
    readonly children?: IChildModel[];
    readonly items: string[] = [];

    constructor(attributes?: ITestAttributes) {
        super(attributes && attributes.id, attributes && attributes.revision);

        if (attributes) {
            this.foo = attributes.foo;
            this.bar = attributes.bar;
            this.children = attributes.children;
            this.items = attributes.items;
        }
    }

    addChild(child: IChildModel): void {
        (<Mutable<TestModel>>this).children = this.children || [];
        this.children!.push(child);
    }

    addItem(item: string): void {
        this.items.push(item);
    }

    removeChild(id: string): IChildModel | undefined {
        if (this.children) {
            for (let i = 0; i < this.children.length; i++) {
                if (this.children[i].id === id) {
                    return this.children.splice(i, 1)[0];
                }
            }
        }

        return undefined;
    }

    removeItem(item: string): string | undefined {
        const index = this.items.indexOf(item);

        if (index > -1) {
            return this.items.splice(index, 1)[0];
        }

        return undefined;
    }

    protected getValidation(): IModelValidation<ITestAttributes, this> {
        return createValidation(zod.object({
            id: zod.string(),
            foo: zod.string().optional(),
            bar: zod.string().optional(),
            children: zod.array(zod.any()).optional(),
            items: zod.array(zod.string()),
            revision: zod.number()
        }));
    }
}

class ChildModel extends Model<IChildAttributes> implements IChildModel {
    value: string = "";

    constructor(attributes?: IChildAttributes) {
        super(attributes && attributes.id, attributes && attributes.revision);

        if (attributes) {
            this.value = attributes.value;
        }
    }

    protected getValidation(): IModelValidation<IChildAttributes, this> {
        return createValidation(zod.object({
            id: zod.string(),
            value: zod.string().nonempty("Value is required.")
        }));
    }
}

/** Mock API for fetching resources from the server. */
class MockApi {
    readonly children = new Map<string, IChild>();

    getChild(id: string): Promise<IChild | undefined> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.children.get(id));
        }, 
        0));
    }
}

/** Mock storage for edit operations. */
class MockEditStore {
    private readonly records: IEditRecord[] = [];

    addEdit(modelType: string, modelId: string, edit: IEditOperation): number {
        const record = { modelType, modelId, edit, revision: this.getNextRevisionNumber(modelType, modelId) };
        this.records.push(record);
        return record.revision;
    }

    getRecords(modelType: string, modelId: string, startRevision?: number): IEditRecord[] {
        const result: IEditRecord[] = [];
        this.records.forEach(record => {
            if (record.modelType === modelType && record.modelId === modelId) {
                result.push(record);
            }
        });

        // assume the revisions are in order and sequential
        return startRevision ? result.slice(startRevision - 1) : result;
    }

    private getNextRevisionNumber(modelType: string, modelId: string): number {
        for (let i = this.records.length - 1; i >= 0; i--) {
            if (this.records[i].modelType === modelType && this.records[i].modelId === modelId) {
                return this.records[i].revision + 1;
            }
        }

        return 1;
    }
}

class ChildController extends EditController<IChildModel> {
    protected modelType = "child";

    constructor(private readonly store: MockEditStore, model: IChildModel, parent: TestController) {
        super(model, parent);

        this.registerEditHandlers("update", {
            apply: this.applyUpdate.bind(this),
            submit: this.submitEdit.bind(this)
        });
    }

    updateValue(value: string): Promise<IPublishEditResult> {
        return this.publishEdit<IUpdateChild>({ type: "update", data: { value } });
    }

    protected fetchEdits(startRevision?: number): Promise<IEditOperation[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => record.edit));
        }, 
        0));
    }

    private applyUpdate(edit: IUpdateChild): ApplyResult<IUpdateChild> {
        const oldValue = this.model.value;
        this.model.value = edit.data.value;

        return { 
            success: true,
            reverse: { 
                type: "update", 
                data: { value: oldValue }
            }
        };
    }

    private submitEdit(edit: IEditOperation): Promise<SubmitResult> {
        return new Promise(resolve => setTimeout(() => {
            resolve({ success: true, revision: this.store.addEdit(this.modelType, this.model.id, edit) });
        }, 
        0));
    }
}

class TestController extends EditController<ITestModel> {
    protected modelType = "test";

    constructor(
        private readonly api: MockApi,
        private readonly store: MockEditStore, 
        model: ITestModel, 
        stream: IEditEventStream) {
        super(model, stream);

        this.registerEditHandlers("addChild", {
            apply: this.applyAddChild.bind(this),
            submit: this.submitEdit.bind(this)
        });

        this.registerEditHandlers("addItem", {
            apply: this.applyAddItem.bind(this),
            submit: this.submitEdit.bind(this)
        });

        this.registerEditHandlers("removeChild", {
            apply: this.applyRemoveChild.bind(this),
            submit: this.submitEdit.bind(this)
        });

        this.registerEditHandlers("removeItem", {
            apply: this.applyRemoveItem.bind(this),
            submit: this.submitEdit.bind(this)
        });

        this.registerEditHandlers("update", {
            apply: this.applyUpdate.bind(this),
            submit: this.submitEdit.bind(this)
        });
    }

    addChild(childId: string): Promise<IPublishEditResult> {
        return this.publishEdit<IAddChild>({ type: "addChild", data: { childId } });
    }

    addItem(item: string): Promise<IPublishEditResult> {
        return this.publishEdit<IAddItem>({ type: "addItem", data: { item } });
    }

    removeChild(childId: string): Promise<IPublishEditResult> {
        return this.publishEdit<IRemoveChild>({ type: "removeChild", data: { childId } });
    }

    removeItem(item: string): Promise<IPublishEditResult> {
        return this.publishEdit<IRemoveItem>({ type: "removeItem", data: { item } });
    }

    update(foo: string, bar: string): Promise<IPublishEditResult> {
        return this.publishEdit<IUpdateTest>({ type: "update", data: { foo, bar } });
    }

    protected fetchEdits(startRevision?: number): Promise<IEditOperation[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => record.edit));
        }, 
        0));
    }

    protected getChildController(modelType: string, modelId: string): EditController | undefined {
        if (modelType !== "child") {
            throw new Error("Model type not expected.");
        }

        if (this.model.children) {
            for (const child of this.model.children) {
                if (child.id === modelId) {
                    return new ChildController(this.store, child, this);
                }
            }
        }

        return undefined;
    }

    private async applyAddChild(edit: IAddChild): Promise<ApplyResult<IRemoveChild>> {
        const child = await this.api.getChild(edit.data.childId);

        if (child) {
            this.model.addChild(new ChildModel(child));

            return {
                success: true,
                reverse: { type: "removeChild", data: edit.data }
            };
        }

        return { 
            success: false,
            error: new Error(`Failed to fetch child (${edit.data.childId}).`)
        };
    }

    private applyAddItem(edit: IAddItem): ApplyResult<IRemoveItem> {
        this.model.addItem(edit.data.item);

        return {
            success: true,
            reverse: { type: "removeItem", data: edit.data }
        };
    }

    private applyRemoveChild(edit: IRemoveChild): ApplyResult<IAddChild> {
        const child = this.model.removeChild(edit.data.childId);

        if (child) {
            return {
                success: true,
                reverse: { type: "addChild", data: edit.data }
            };
        }

        return { 
            success: false,
            error: new Error(`Child not found (${edit.data.childId}).`)
        };
    }

    private applyRemoveItem(edit: IAddItem): ApplyResult<IAddItem> {
        const item = this.model.removeItem(edit.data.item);

        if (item) {
            return {
                success: true,
                reverse: { type: "addItem", data: edit.data }
            };
        }

        return { 
            success: false,
            error: new Error(`Item not found (${edit.data.item}).`)
        };
    }

    private applyUpdate(edit: IUpdateTest): ApplyResult<IUpdateTest> {
        const reverse: IUpdateTest = { 
            type: "update", 
            data: { 
                foo: this.model.foo, 
                bar: this.model.bar 
            }
        };

        this.model.foo = edit.data.foo;
        this.model.bar = edit.data.bar;

        return { success: true, reverse };
    }

    private submitEdit(edit: IEditOperation): Promise<SubmitResult> {
        return new Promise(resolve => setTimeout(() => {
            resolve({ success: true, revision: this.store.addEdit(this.modelType, this.model.id, edit) });
        }, 
        0));
    }
}

describe("edit controller", () => {
    test("", () => {

    });
});

describe("synchronizer", () => {
    test("synchronize model with new edits", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            revision: 1
        });

        const synchronizer = new Synchronizer(model, () => Promise.resolve([{
            type: "update",
            data: {
                foo: "foo2",
                bar: "bar2"
            }
        }]));
       
        await synchronizer.synchronize();

        expect(model.foo).toBe("foo2");
        expect(model.bar).toBe("bar2");
        expect(model.revision).toBe(2);
    });

    test("synchronize model with multiple concurrent requests", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            revision: 1
        });

        const results = [
            {
                type: "update",
                data: {
                    foo: "foo2",
                    bar: "bar2"
                }
            },
            {
                type: "update",
                data: {
                    foo: "foo3",
                    bar: "bar3"
                }
            }
        ];

        let count = 1;
        const synchronizer = new Synchronizer(model, (_, startRevision) => new Promise(resolve => {
            const end = count++;
            // the start revision will be the model's current revision + 1
            setTimeout(() => resolve(results.slice((startRevision || 0) - 2, end)), 0);
        }));
       
        // the first synchronize will only contain the first edit whereas the second synchronize will contain both
        synchronizer.synchronize();
        // the second call will return the promise for the first request
        await synchronizer.synchronize();
        // this call should invoke the synchronize another time
        await synchronizer.synchronize();

        expect(model.foo).toBe("foo3");
        expect(model.bar).toBe("bar3");
        expect(model.revision).toBe(3);
    });
});
