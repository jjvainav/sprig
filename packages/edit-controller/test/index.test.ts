import { EditModel, IEditModel } from "@sprig/edit-model";
import { IEditOperation } from "@sprig/edit-operation";
import * as zod from "zod";
import { EditEventController, IEditEvent, IEditEventStream, ISubmitEditOutcome } from "../src";

interface IEditRecord {
    readonly modelId: string;
    readonly modelType: string;
    readonly edit: IEditOperation;
    readonly revision: number;
}

interface ITest {
    readonly id: string;
    readonly foo?: string;
    readonly bar?: string;
    readonly children?: (string | IChild)[];
    readonly items: string[];
    readonly revision: number;
}

interface IChild {
    readonly id: string;
    readonly value: string;
    readonly revision: number;
}

interface ITestModel extends IEditModel<ITest> {
    readonly children?: IChildModel[];
}

interface IChildModel extends IEditModel<IChild> {
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

const childSchema: zod.Schema<IChild> = zod.object({
    id: zod.string(),
    value: zod.string(),
    revision: zod.number()
});

const testSchema: zod.Schema<ITest> = zod.object({
    id: zod.string(),
    foo: zod.string().optional(),
    bar: zod.string().optional(),
    children: zod.array(zod.union([zod.string(), childSchema])).optional(),
    items: zod.array(zod.string()),
    revision: zod.number()
});

// TODO: consider adding edit-event-mongodb to sprig, call it edit-repository-mongodb?
// -- need to create tests for it
// TODO: use model factory for creating a model with children models?
// -- instead of accepting attributes from constructor accept properties where child props are models
// TODO: look at how model tests handle child models
// -- in model package when validating should child models also be validated?
// TODO: when applying an add child edit need to fetch the child attributes before adding child model to parent
class TestModel extends EditModel<ITest> implements ITestModel {
    foo?: string;
    bar?: string;
    children?: (string | IChild)[];
    items: string[] = [];

    constructor(attributes?: ITest) {
        super(testSchema);

        this.setAttributes(attributes || { id: "1", items: [], revision: 1 });
        this.registerHandler("addChild", this.applyAddChild.bind(this));
        this.registerHandler("addItem", this.applyAddItem.bind(this));
        this.registerHandler("removeChild", this.applyRemoveChild.bind(this));
        this.registerHandler("removeItem", this.applyRemoveItem.bind(this));
        this.registerHandler("update", this.applyUpdate.bind(this));
    }

    createAddChildEdit(child: string | IChild): IAddChild {
        return { 
            type: "addChild", 
            data: { childId: typeof child === "string" ? child : child.id } 
        };
    }

    createAddItemEdit(item: string): IAddItem {
        return { type: "addItem", data: { item } };
    }

    createRemoveChildEdit(child: string | IChild): IRemoveChild {
        return { 
            type: "removeChild", 
            data: { childId: typeof child === "string" ? child : child.id } 
        };
    }

    createRemoveItemEdit(item: string): IRemoveItem {
        return { type: "removeItem", data: { item } };
    }

    createUpdateEdit(foo: string, bar: string): IUpdateTest {
        return { type: "update", data: { foo, bar } };
    }

    private applyAddChild(edit: IAddChild): IRemoveChild {
        this.children = this.children || [];
        this.children.push(edit.data.childId);
        return { type: "removeChild", data: edit.data };
    }

    private applyAddItem(edit: IAddItem): IRemoveItem {
        this.items.push(edit.data.item);
        return { type: "removeItem", data: edit.data };
    }

    private applyRemoveChild(edit: IRemoveChild): IAddChild | undefined {
        if (this.children) {
            for (let i = 0; i < this.children.length; i++) {
                const child = this.children[i];
                const childId = typeof child === "string" ? child : child.id;

                if (child === edit.data.childId) {
                    this.children.splice(i, 1);
                    return { type: "addChild", data: edit.data };
                }
            }
        }

        return undefined;
    }

    private applyRemoveItem(edit: IAddItem): IAddItem | undefined {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item === edit.data.item) {
                this.items.splice(i, 1);
                return { type: "addItem", data: edit.data };
            }
        }

        return undefined;
    }

    private applyUpdate(edit: IUpdateTest): IUpdateTest {
        const reverse: IUpdateTest = { 
            type: "update", 
            data: { 
                foo: this.foo, 
                bar: this.bar 
            }
        };

        this.foo = edit.data.foo;
        this.bar = edit.data.bar;

        return reverse;
    }
}

class ChildModel extends EditModel<IChild> implements IChildModel {
    readonly id: string = "";
    value: string = "";

    constructor(attributes?: IChild) {
        super(childSchema);

        this.setAttributes(attributes || { id: "1", value: "", revision: 1 });
        this.registerHandler("update", this.applyUpdate.bind(this));
    }

    createUpdateEdit(value: string): IUpdateChild {
        return { type: "update", data: { value } };
    }

    private applyUpdate(edit: IUpdateChild): IUpdateChild {
        const reverse: IUpdateChild = { 
            type: "update", 
            data: { value: this.value }
        };

        this.value = edit.data.value;
        return reverse;
    }
}

class MockEditStore {
    private readonly records: IEditRecord[]

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

class ChildController extends EditEventController<ChildModel> {
    protected modelType = "child";

    constructor(private readonly store: MockEditStore, model: ChildModel, parent: TestController) {
        super(model, parent);
        this.registerSubmitEditHandler("update", this.submitEdit.bind(this));
    }

    protected fetchEdits(startRevision?: number): Promise<IEditOperation[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => record.edit));
        }, 
        0));
    }

    private submitEdit(edit: IEditOperation, outcome: ISubmitEditOutcome): void {
        setTimeout(() => outcome.success(this.store.addEdit(this.modelType, this.model.id, edit)), 0);
    }
}

class TestController extends EditEventController<TestModel> {
    protected modelType = "test";

    constructor(private readonly store: MockEditStore, model: TestModel, stream: IEditEventStream) {
        super(model, stream);

        this.registerSubmitEditHandler("addChild", this.submitEdit.bind(this));
        this.registerSubmitEditHandler("addItem", this.submitEdit.bind(this));
        this.registerSubmitEditHandler("removeChild", this.submitEdit.bind(this));
        this.registerSubmitEditHandler("removeItem", this.submitEdit.bind(this));
        this.registerSubmitEditHandler("update", this.submitEdit.bind(this));
    }

    protected fetchEdits(startRevision?: number): Promise<IEditOperation[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => record.edit));
        }, 
        0));
    }

    protected getChildControllerForModel(modelType: string, modelId: string): EditEventController | undefined {
        if (modelType !== "child") {
            throw new Error("Model type not expected.");
        }


    }

    private submitEdit(edit: IEditOperation, outcome: ISubmitEditOutcome): void {
        setTimeout(() => outcome.success(this.store.addEdit(this.modelType, this.model.id, edit)), 0);
    }
}

describe("edit event stream controller", () => {
    test("", () => {

    });
});