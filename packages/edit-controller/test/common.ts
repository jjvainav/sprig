import { IEditOperation } from "@sprig/edit-operation";
import { EventEmitter } from "@sprig/event-emitter";
import { Model, IModel, IModelValidation } from "@sprig/model";
import { createValidation } from "@sprig/model-zod";
import * as zod from "zod";
import { ApplyResult, EditController, IEditEvent, IEditEventStream, IEditEventStreamConnection, IPublishEditResult, SubmitResult } from "../src";

type Mutable<T> = { -readonly[P in keyof T]: T[P] };

export interface IEditRecord {
    readonly modelId: string;
    readonly modelType: string;
    readonly edit: IEditOperation;
    readonly revision: number;
}

/** Used to initialize a test model. */
export interface ITestAttributes {
    readonly id: string;
    readonly foo?: string;
    readonly bar?: string;
    readonly children?: IChildModel[];
    readonly items: string[];
    readonly revision: number;
}

/** Used to initialize a child model. */
export interface IChildAttributes {
    readonly id: string;
    readonly value: string;
    readonly revision: number;
}

/** A child object returned from the mock API. */
export interface IChild {
    readonly id: string;
    readonly value: string;
    readonly revision: number; 
}

export interface ITestModel extends IModel<ITestAttributes>, ITestAttributes {
    foo?: string;
    bar?: string;

    addChild(child: IChildModel): void;
    addItem(item: string): void;
    removeChild(id: string): IChildModel | undefined;
    removeItem(item: string): string | undefined;
}

export interface IChildModel extends IModel<IChildAttributes>, IChildAttributes {
    value: string;
}

export interface IAddChild extends IEditOperation {
    readonly type: "addChild";
    readonly data: {
        readonly childId: string;
    };
}

export interface IAddItem extends IEditOperation {
    readonly type: "addItem";
    readonly data: {
        readonly item: string;
    };
}

export interface ICreateTest extends IEditOperation {
    readonly type: "create";
    readonly data: {
        readonly foo?: string;
        readonly bar?: string;
    };
}

export interface ICreateChild extends IEditOperation {
    readonly type: "create";
    readonly data: {
        readonly value: string;
    };
}

export interface IRemoveChild extends IEditOperation {
    readonly type: "removeChild";
    readonly data: {
        readonly childId: string;
    };
}

export interface IRemoveItem extends IEditOperation {
    readonly type: "removeItem";
    readonly data: {
        readonly item: string;
    };
}

export interface IUpdateTest extends IEditOperation {
    readonly type: "update";
    readonly data: {
        readonly foo?: string;
        readonly bar?: string;
    };
}

export interface IUpdateChild extends IEditOperation {
    readonly type: "update";
    readonly data: {
        readonly value: string;
    };
}

export namespace Edits {
    export const createAddChildEdit = (childId: string): IAddChild => ({ type: "addChild", data: { childId } });
    export const createAddItemEdit = (item: string): IAddItem => ({ type: "addItem", data: { item } });
    export const createUpdateChildEdit = (value: string): IUpdateChild => ({ type: "update", data: { value } });
    export const createUpdateTestEdit = (foo: string, bar: string): IUpdateTest => ({ type: "update", data: { foo, bar } });
}

export class TestModel extends Model<ITestAttributes> implements ITestModel {
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

export class ChildModel extends Model<IChildAttributes> implements IChildModel {
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
export class MockApi {
    readonly children = new Map<string, IChild>();

    getChild(id: string): Promise<IChild | undefined> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.children.get(id));
        }, 
        Math.floor(Math.random() * 20)));
    }
}

/** Mock storage for edit operations. */
export class MockEditStore {
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

export class MockEditEventStream implements IEditEventStream<IEditEvent, Error> {
    private readonly data = new EventEmitter<IEditEvent>("data");

    /** An error to return when attempting to open a stream to simulate a failed connection attempt. */
    connectionError?: Error;

    openStream(): Promise<IEditEventStreamConnection<IEditEvent, Error>> {
        return new Promise(resolve => setTimeout(() => {
            resolve({
                error: this.connectionError,
                isOpen: !this.connectionError,
                onData: this.data.event,
                close: this.close.bind(this)
            });
        },
        0));
    }

    /** Pushes an edit event onto the currently opened stream. This is useful for testing receiving events from a remote source/server. */
    pushEvent(event: IEditEvent): Promise<void> {
        return this.data.emit(event);
    }

    toEditEvent(data: IEditEvent): IEditEvent {
        // this method allows a stream to return data in a different format and then convert into an IEditEvent object
        // for sake of testing and simplicity we are just going to use the IEditEvent for pushing data through the stream
        return data;
    }

    private close(): void {

    }
}

export class ChildController extends EditController<IChildModel> {
    modelType = "child";

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

export class TestController extends EditController<ITestModel> {
    modelType = "test";

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