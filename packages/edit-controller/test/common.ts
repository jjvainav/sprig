import { IEditOperation } from "@sprig/edit-operation";
import { EventEmitter, IEvent } from "@sprig/event-emitter";
import { EditController, IApplyEditResult, IEditController, IEditEvent, IEditEventStream, IEditEventStreamData, IModel, ISubmitEditResult, Synchronizer } from "../src";

type Mutable<T> = { -readonly[P in keyof T]: T[P] };

export interface IEditRecord {
    readonly modelId: string;
    readonly modelType: string;
    readonly edit: IEditOperation;
    readonly timestamp: number;
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

export interface ITestModel extends IModel, ITestAttributes {
    foo?: string;
    bar?: string;

    addChild(child: IChildModel): void;
    addItem(item: string): void;
    removeChild(id: string): IChildModel | undefined;
    removeItem(item: string): string | undefined;
}

export interface IChildModel extends IModel, IChildAttributes {
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

export interface IInitTest extends IEditOperation {
    readonly type: "init";
    readonly data: {
        readonly foo?: string;
        readonly bar?: string;
    };
}

export interface IInitChild extends IEditOperation {
    readonly type: "init";
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

export function unixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

export namespace Edits {
    export const createAddChildEdit = (childId: string): IAddChild => ({ type: "addChild", data: { childId } });
    export const createAddItemEdit = (item: string): IAddItem => ({ type: "addItem", data: { item } });
    export const createUpdateChildEdit = (value: string): IUpdateChild => ({ type: "update", data: { value } });
    export const createUpdateTestEdit = (foo: string, bar: string): IUpdateTest => ({ type: "update", data: { foo, bar } });
}

export class TestModel implements ITestModel {
    foo?: string;
    bar?: string;
    revision: number;
    
    readonly id: string;
    readonly children?: IChildModel[];
    readonly items: string[] = [];

    constructor(attributes: ITestAttributes) {
        this.id = attributes.id;
        this.foo = attributes.foo;
        this.bar = attributes.bar;
        this.children = attributes.children;
        this.items = attributes.items;
        this.revision = attributes.revision;
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

    setRevision(revision: number): void {
        this.revision = revision;
    }
}

export class ChildModel implements IChildModel {
    value: string = "";
    revision: number;
    
    readonly id: string;

    constructor(attributes: IChildAttributes) {
        this.id = attributes.id;
        this.value = attributes.value;
        this.revision = attributes.revision;
    }

    setRevision(revision: number): void {
        this.revision = revision;
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
        const record = { 
            modelType, 
            modelId, 
            edit, 
            timestamp: unixTimestamp(),
            revision: this.getNextRevisionNumber(modelType, modelId) 
        };

        this.records.push(record);
        return record.revision;
    }

    getRecords(modelType: string, modelId: string, startRevision?: number): IEditRecord[] {
        const result: IEditRecord[] = this.getEditsForModel(modelType, modelId);
        return startRevision ? result.filter(record => record.revision >= startRevision) : result;
    }

    /** Randomize the order of the records stored. Useful for testing edits that get out of order. */
    randomize(): void {
        this.records.sort(() => Math.random() > .5 ? 1 : -1);
    }

    private getEditsForModel(modelType: string, modelId: string): IEditRecord[] {
        return this.records.filter(record => record.modelType === modelType && record.modelId === modelId);
    }

    private getNextRevisionNumber(modelType: string, modelId: string): number {
        const result: IEditRecord[] = this.getEditsForModel(modelType, modelId);
        result.sort((a, b) => a.revision - b.revision);
        return result.length > 0 ? result[result.length - 1].revision + 1 : 1;
    }
}

/** A mock edit event stream; for the sake of simplicity the stream will push data using the IEditEventStreamData format. */
export class MockEditEventStream implements IEditEventStream {
    private readonly data = new class extends EventEmitter<IEditEventStreamData> {
        get connectionCount(): number {
            return this.count;
        }
    }();

    get onData(): IEvent<IEditEventStreamData> {
        return this.data.event;
    }

    get connectionCount(): number { 
        return this.data.connectionCount;
    }

    pushEvent(data: IEditEventStreamData): Promise<void> {
        return new Promise(resolve => setTimeout(() => {
            this.data.emit(data);
            resolve();
        }, 
        0));
    }
}

export class ChildController extends EditController<IChildModel> {
    constructor(private readonly store: MockEditStore, model: IChildModel, parent: EditController) {
        super({ 
            model, 
            modelType: "child",
            processManager: parent.processManager,
            synchronizer: new Synchronizer((_, __, startRevision) => this.fetchEdits(startRevision))
        });

        this.registerEditHandlers("update", {
            apply: this.applyUpdate.bind(this),
            submit: this.submitEdit.bind(this)
        });
    }

    updateValue(value: string): Promise<IApplyEditResult> {
        return this.publishEdit<IUpdateChild>({ type: "update", data: { value } });
    }

    private fetchEdits(startRevision?: number): Promise<IEditEvent[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => ({
                edit: record.edit,
                timestamp: record.timestamp,
                revision: record.revision
            })));
        }, 
        0));
    }

    private applyUpdate(edit: IUpdateChild): IApplyEditResult<IUpdateChild> {
        const oldValue = this.model.value;
        this.model.value = edit.data.value;

        return { 
            success: true,
            edit,
            reverse: { 
                type: "update", 
                data: { value: oldValue }
            }
        };
    }

    private submitEdit(edit: IEditOperation): Promise<ISubmitEditResult> {
        return new Promise(resolve => setTimeout(() => {
            resolve({ success: true, edit, revision: this.store.addEdit(this.modelType, this.model.id, edit) });
        }, 
        0));
    }
}

export class TestController extends EditController<ITestModel> {
    private failNextApply = false;
    private failNextSubmit = false;
    private applyError?: Error;
    private submitError?: Error;
    
    modelType = "test";

    constructor(
        private readonly api: MockApi, 
        private readonly store: MockEditStore, 
        model: ITestModel, 
        stream: IEditEventStream) {
        super({
            model,
            modelType: "test",
            stream,
            synchronizer: new Synchronizer((_, __, startRevision) => this.fetchEdits(startRevision))
        });

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

    addChild(childId: string): Promise<IApplyEditResult> {
        return this.publishEdit<IAddChild>({ type: "addChild", data: { childId } });
    }

    addItem(item: string): Promise<IApplyEditResult> {
        return this.publishEdit<IAddItem>({ type: "addItem", data: { item } });
    }

    failOnNextApply(error?: Error): void {
        this.failNextApply = true;
        this.applyError = error;
    }

    failOnNextSubmit(error?: Error): void {
        this.failNextSubmit = true;
        this.submitError = error;
    }

    removeChild(childId: string): Promise<IApplyEditResult> {
        return this.publishEdit<IRemoveChild>({ type: "removeChild", data: { childId } });
    }

    removeItem(item: string): Promise<IApplyEditResult> {
        return this.publishEdit<IRemoveItem>({ type: "removeItem", data: { item } });
    }

    update(foo: string, bar: string): Promise<IApplyEditResult> {
        return this.publishEdit<IUpdateTest>({ type: "update", data: { foo, bar } });
    }

    protected fetchEdits(startRevision?: number): Promise<IEditEvent[]> {
        return new Promise(resolve => setTimeout(() => {
            resolve(this.store.getRecords(this.modelType, this.model.id, startRevision).map(record => ({
                edit: record.edit,
                timestamp: record.timestamp,
                revision: record.revision
            })));
        }, 
        0));
    }

    protected getController(modelType: string, modelId: string): IEditController | undefined {
        if (modelType === "child") {
            if (this.model.children) {
                for (const child of this.model.children) {
                    if (child.id === modelId) {
                        return new ChildController(this.store, child, this);
                    }
                }
            }
        }

        return super.getController(modelType, modelId);
    }

    private async applyAddChild(edit: IAddChild): Promise<IApplyEditResult<IRemoveChild>> {
        return this.tryApplyAsyncEdit(edit, async () => {
            const child = await this.api.getChild(edit.data.childId);

            if (child) {
                this.model.addChild(new ChildModel(child));

                return {
                    success: true,
                    edit,
                    reverse: { type: "removeChild", data: edit.data }
                };
            }

            return { 
                success: false,
                edit,
                error: new Error(`Failed to fetch child (${edit.data.childId}).`)
            };
        });
    }

    private applyAddItem(edit: IAddItem): IApplyEditResult<IRemoveItem> {
        return this.tryApplyEdit(edit, () => {
            this.model.addItem(edit.data.item);

            return {
                success: true,
                edit,
                reverse: { type: "removeItem", data: edit.data }
            };
        });
    }

    private applyRemoveChild(edit: IRemoveChild): IApplyEditResult<IAddChild> {
        return this.tryApplyEdit(edit, () => {
            const child = this.model.removeChild(edit.data.childId);

            if (child) {
                return {
                    success: true,
                    edit,
                    reverse: { type: "addChild", data: edit.data }
                };
            }

            return { 
                success: false,
                edit,
                error: new Error(`Child not found (${edit.data.childId}).`)
            };
        });
    }

    private applyRemoveItem(edit: IAddItem): IApplyEditResult<IAddItem> {
        return this.tryApplyEdit(edit, () => {
            const item = this.model.removeItem(edit.data.item);

            if (item) {
                return {
                    success: true,
                    edit,
                    reverse: { type: "addItem", data: edit.data }
                };
            }

            return { 
                success: false,
                edit,
                error: new Error(`Item not found (${edit.data.item}).`)
            };
        });
    }

    private applyUpdate(edit: IUpdateTest): IApplyEditResult<IUpdateTest> {
        return this.tryApplyEdit(edit, () => {
            const reverse: IUpdateTest = { 
                type: "update", 
                data: { 
                    foo: this.model.foo, 
                    bar: this.model.bar 
                }
            };
    
            this.model.foo = edit.data.foo;
            this.model.bar = edit.data.bar;
    
            return { success: true, edit, reverse };
        });
    }

    private submitEdit(edit: IEditOperation): Promise<ISubmitEditResult> {
        return new Promise((resolve, reject) => setTimeout(() => {
            if (this.submitError) {
                reject(this.submitError);
                this.failNextSubmit = false;
                this.submitError = undefined;
                return;
            }

            if (this.failNextSubmit) {
                this.failNextSubmit = false;
                resolve({ success: false, edit });
                return;
            }

            resolve({ success: true, edit, revision: this.store.addEdit(this.modelType, this.model.id, edit) });
        }, 
        0));
    }

    private tryApplyEdit<TReverseEdit extends IEditOperation>(edit: IEditOperation, handler: () => IApplyEditResult<TReverseEdit>): IApplyEditResult<TReverseEdit> {
        if (this.applyError) {
            const error = this.applyError;
            this.failNextApply = false;
            this.applyError = undefined;
            throw error;
        }

        if (this.failNextApply) {
            this.failNextApply = false;
            return { success: false, edit };
        }

        return handler();
    }

    private tryApplyAsyncEdit<TReverseEdit extends IEditOperation>(edit: IEditOperation, handler: () => Promise<IApplyEditResult<TReverseEdit>>): Promise<IApplyEditResult<TReverseEdit>> {
        return new Promise((resolve, reject) => setTimeout(() => {
            if (this.applyError) {
                reject(this.applyError);
                this.failNextApply = false;
                this.applyError = undefined;
                return;
            }

            if (this.failNextApply) {
                this.failNextApply = false;
                resolve({ success: false, edit });
                return;
            }

            handler().then(result => resolve(result)).catch(error => reject(error));
        }, 
        0));
    }
}