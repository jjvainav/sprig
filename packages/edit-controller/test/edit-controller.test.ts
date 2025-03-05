import { EditHistory } from "../../edit-history";
import { IEditOperation } from "../../edit-operation";
import { IReceivedEditResult } from "../src";
import { 
    Edits, IAddChild, IChild, IInitChild, IInitTest, MockApi, MockEditEventStream, MockEditStore, 
    toEditHistoryPublisher, TestController, TestModel 
} from "./common";

interface ITestContext {
    readonly controller: TestController;
    readonly api: MockApi;
    readonly store: MockEditStore;
    readonly stream: MockEditEventStream;
    createChild(value: string): IChild; 
}

interface ITestContextOptions {
    readonly api?: MockApi;
    readonly store?: MockEditStore;
    readonly stream?: MockEditEventStream;
}

let nextId = 100;
function createTestContext(options?: ITestContextOptions): ITestContext {
    // the api is used to simulate fetching resource/model objects from a server
    const api = options && options.api || new MockApi();
    // the store is used to store edits for resources/models
    const store = options && options.store || new MockEditStore();
    // the stream is used to simulate pushing events from the server to the client
    const stream = options && options.stream || new MockEditEventStream();

    const id = (nextId++).toString();
    const model = new TestModel({ id, items: [], revision: 1 });
    const initEdit: IInitTest = { type: "init", data: {} };
    const createChild = (value: string) => {
        const child: IChild = { id: (nextId++).toString(), value, revision: 1 };
        const initEdit: IInitChild = { type: "init", data: { value: child.value } };

        api.children.set(child.id, child);
        store.addEdit("child", child.id, initEdit);
        
        return child;
    };

    // the mock store will auto increment the revision numbers for the edits -- the init edit will have revision 1
    store.addEdit("test", id, initEdit);

    return { 
        controller: new TestController(api, store, model, stream), 
        api, 
        store, 
        stream,
        createChild 
    };
}

describe("edit controller", () => {
    test("publish edit", async () => {
        const { controller, store } = createTestContext();

        const appliedEdits: IEditOperation[] = [];
        controller.onEditApplied(result => appliedEdits.push(result.edit));

        const submittedEdits: IEditOperation[] = [];
        controller.onEditSubmitted(result => submittedEdits.push(result.edit));

        // update will create and publish an update edit
        const applyResult = await controller.update("foo", "bar");

        // publish returns after the edit has been applied but before it has been submitted,
        // this is so the submission can run in the background but if we want to wait we can
        // use the waitForSubmit promise
        //
        // this is usesful so that the browser/ui can remain responsive and if there is a problem
        // submitting, the edit controller will handle synchronizing the model
        const submitResult = await controller.waitForSubmit(applyResult.edit);

        expect(applyResult.success).toBe(true);
        expect(submitResult).toBeDefined();
        expect(submitResult!.success).toBe(true);

        expect(appliedEdits.length).toBe(1);
        expect(appliedEdits[0]).toBe(applyResult.edit);

        expect(appliedEdits.length).toBe(1);
        expect(appliedEdits[0]).toBe(submitResult!.edit);

        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(2);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(2);
        expect(edits[1].edit.type).toBe("update");
        expect(edits[1].revision).toBe(2);
    });

    test("publish async edit", async () => {
        const { controller, store, createChild } = createTestContext();

        const child = createChild("value");

        // the add child edit is async because the controller needs to fetch the child data from the 'api'
        const applyResult = await controller.addChild(child.id);
        const submitResult = await controller.waitForSubmit(applyResult.edit);

        expect(applyResult.success).toBe(true);
        expect(submitResult).toBeDefined();
        expect(submitResult!.success).toBe(true);

        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(1);
        expect(controller.model.children![0].id).toBe(child.id);
        expect(controller.model.revision).toBe(2);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(2);
        expect(edits[1].edit.type).toBe("addChild");
        expect(edits[1].revision).toBe(2);
    });

    test("publish async edit and cancel before it has been applied", async () => {
        const { controller, store, createChild } = createTestContext();

        const child = createChild("value");

        // the add child edit is async because the controller needs to fetch the child data from the 'api'
        const context = controller.publishEdit<IAddChild>({ type: "addChild", data: { childId: child.id } });
        const canceled = context.cancel();
        
        const applyResult = await context.waitForApply();
        const submitResult = await context.waitForSubmit();

        expect(canceled).toBe(true);
        expect(applyResult.success).toBe(false);
        expect(submitResult.success).toBe(false);

        expect(controller.model.children).toBeUndefined();
        expect(controller.model.revision).toBe(1);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(1);
    });

    test("publish async edit and cancel after it has been applied", async () => {
        const { controller, store, createChild } = createTestContext();

        const child = createChild("value");

        // the add child edit is async because the controller needs to fetch the child data from the 'api'
        const context = controller.publishEdit<IAddChild>({ type: "addChild", data: { childId: child.id } });
        const applyResult = await context.waitForApply();
        const canceled = context.cancel();
        const submitResult = await context.waitForSubmit();

        expect(canceled).toBe(false);
        expect(applyResult.success).toBe(true);
        expect(submitResult.success).toBe(true);

        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(1);
        expect(controller.model.children![0].id).toBe(child.id);
        expect(controller.model.revision).toBe(2);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(2);
        expect(edits[1].edit.type).toBe("addChild");
        expect(edits[1].revision).toBe(2);
    });

    test("publish async edit that fails to apply", async () => {
        const { controller } = createTestContext();

        // use an invalid child id to cause the edit to fail
        const applyResult = await controller.addChild("invalid");
        const submitResult = await controller.waitForSubmit(applyResult.edit);

        expect(applyResult.success).toBe(false);
        expect(submitResult).toBeUndefined();
        expect(controller.model.children).toBeUndefined();
    });

    test("publish async edit that throws an error", async () => {
        const { controller, createChild } = createTestContext();

        const child = createChild("value");

        controller.failOnNextApply(new Error());
        const applyResult = await controller.addChild(child.id);
        const submitResult = await controller.waitForSubmit(applyResult.edit);

        expect(applyResult.success).toBe(false);
        expect(submitResult).toBeUndefined();
        expect(controller.model.children).toBeUndefined();
    });

    test("publish multiple edits", async () => { 
        const { controller, store } = createTestContext();

        controller.update("foo", "bar");
        controller.update("foo", "bar2");

        await controller.waitForIdle();

        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar2");
        expect(controller.model.revision).toBe(3);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(3);
        expect(edits[1].edit.type).toBe("update");
        expect(edits[1].revision).toBe(2);
        expect(edits[2].edit.type).toBe("update");
        expect(edits[2].revision).toBe(3);
    });

    test("publish multiple async edits", async () => { 
        const { controller, store, createChild } = createTestContext();

        const child1 = createChild("value1");
        const child2 = createChild("value2");
        const child3 = createChild("value3");

        controller.addChild(child1.id);
        controller.addChild(child2.id);
        controller.addChild(child3.id);

        // wait for all pending edits to be applied and submitted
        await controller.waitForIdle();

        // make sure the children were added and added in order
        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(3);
        expect(controller.model.children![0].id).toBe(child1.id);
        expect(controller.model.children![1].id).toBe(child2.id);
        expect(controller.model.children![2].id).toBe(child3.id);
        expect(controller.model.revision).toBe(4);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(4);
        expect(edits[1].edit.type).toBe("addChild");
        expect(edits[1].edit.data.childId).toBe(child1.id);
        expect(edits[1].revision).toBe(2);
        expect(edits[2].edit.type).toBe("addChild");
        expect(edits[2].edit.data.childId).toBe(child2.id);
        expect(edits[2].revision).toBe(3);
        expect(edits[3].edit.type).toBe("addChild");
        expect(edits[3].edit.data.childId).toBe(child3.id);
        expect(edits[3].revision).toBe(4);
    });

    test("publish multiple async edits and wait for the last edit", async () => { 
        const { controller, store, createChild } = createTestContext();

        const child1 = createChild("value1");
        const child2 = createChild("value2");
        const child3 = createChild("value3");

        controller.addChild(child1.id);
        controller.addChild(child2.id);
        // wait for the edit to be applied and submitted
        await controller.addChild(child3.id).then(result => controller.waitForSubmit(result.edit));

        // make sure the children were added and added in order
        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(3);
        expect(controller.model.children![0].id).toBe(child1.id);
        expect(controller.model.children![1].id).toBe(child2.id);
        expect(controller.model.children![2].id).toBe(child3.id);
        expect(controller.model.revision).toBe(4);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(4);
        expect(edits[1].edit.type).toBe("addChild");
        expect(edits[1].edit.data.childId).toBe(child1.id);
        expect(edits[1].revision).toBe(2);
        expect(edits[2].edit.type).toBe("addChild");
        expect(edits[2].edit.data.childId).toBe(child2.id);
        expect(edits[2].revision).toBe(3);
        expect(edits[3].edit.type).toBe("addChild");
        expect(edits[3].edit.data.childId).toBe(child3.id);
        expect(edits[3].revision).toBe(4);
    });

    test("publish edit when revision is behind server revision causing the model to synchronize", async () => { 
        const { controller, store, createChild } = createTestContext();
        const child = createChild("value");

        // add a few edits to the store, these will update the model when the controller attempts to sync with the 'server'
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar2"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddItemEdit("item"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddChildEdit(child.id));

        // randomize the order to make sure the controller will handle them correctly
        store.randomize();

        // at this point the current model is out dated (i.e. edits have been saved on the 'server')
        // edits are applied as 'last-one-wins' regardless of revision but expect the controller to sync the model with stored edits
        await controller.update("foo", "test");
        await controller.waitForIdle();

        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("test");
        expect(controller.model.items).toHaveLength(1);
        expect(controller.model.items[0]).toBe("item");
        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(1);
        expect(controller.model.children![0].id).toBe(child.id);
        expect(controller.model.children![0].value).toBe(child.value);
        expect(controller.model.children![0].revision).toBe(child.revision);
        expect(controller.model.revision).toBe(6);

        expect(edits.length).toBe(6);
        // make sure the 'out dated' edit gets added to the end
        expect(edits[5].edit.type).toBe("update");
        expect(edits[5].edit.data.foo).toBe("foo");
        expect(edits[5].edit.data.bar).toBe("test");
        expect(edits[5].revision).toBe(6);
    });

    test("publish edit that causes the model to synchronize where the controller receives an invalid edit during synchronization", async () => { 
        const { controller, store, createChild } = createTestContext();
        const child = createChild("value");
        let synchronizeCount = 0;
        let synchronizeFailed = false;

        controller.onSynchronized.once(result => {
            synchronizeCount++;
            synchronizeFailed = !result.success;
        });

        // add a few edits to the store, these will update the model when the controller attempts to sync with the 'server'
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar2"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddItemEdit("item"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddChildEdit(child.id));
        // add an unknown/invalid edit
        store.addEdit(controller.modelType, controller.model.id, { type: "unknown", data: {} });

        // at this point the current model is out dated (i.e. edits have been saved on the 'server')
        // edits are applied as 'last-one-wins' regardless of revision but expect the controller to sync the model with stored edits
        await controller.update("foo", "test");
        await controller.waitForIdle();

        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        // the synchronization will fail when processing the 'unknown' edit and skip processing any more events
        //  at this point, the model for the controller will be at a revision prior to publishing the update to set bar = test
        expect(synchronizeCount).toBe(1);
        expect(synchronizeFailed).toBe(true);
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar2");
        expect(controller.model.items).toHaveLength(1);
        expect(controller.model.items[0]).toBe("item");
        expect(controller.model.children).toBeDefined();
        expect(controller.model.children).toHaveLength(1);
        expect(controller.model.children![0].id).toBe(child.id);
        expect(controller.model.children![0].value).toBe(child.value);
        expect(controller.model.children![0].revision).toBe(child.revision);
        expect(controller.model.revision).toBe(5);

        expect(edits.length).toBe(7);
        // make sure the 'out dated' edit gets added to the end
        expect(edits[6].edit.type).toBe("update");
        expect(edits[6].edit.data.foo).toBe("foo");
        expect(edits[6].edit.data.bar).toBe("test");
        expect(edits[6].revision).toBe(7);
    });

    test("publish edit that fails to submit", async () => { 
        const { controller } = createTestContext();

        const result = await controller.update("foo", "bar");
        await controller.waitForSubmit(result.edit);

        controller.failOnNextSubmit();
        const result2 = await controller.update("foo2", "bar2");
        await controller.waitForIdle();

        // verify that the edit was still applied and that it is rolledback after a failed submit
        expect(result2.success).toBe(true);
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(2);
    });

    test("publish edit that fails to submit and throws an error", async () => { 
        const { controller } = createTestContext();

        const result = await controller.update("foo", "bar");
        await controller.waitForSubmit(result.edit);

        controller.failOnNextSubmit(new Error("Submit failed."));
        const result2 = await controller.update("foo2", "bar2");
        await controller.waitForIdle();

        // verify that the edit was still applied and that it is rolledback after a failed submit
        expect(result2.success).toBe(true);
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(2);
    });

    test("publish edit after a previous edit failed to submit", async () => { 
        const { controller } = createTestContext();

        const result = await controller.update("foo", "bar");
        await controller.waitForSubmit(result.edit);

        // immediately apply another update after the failed update to simulate an edit being applied before the failed edit finished submitting
        // 1) apply foo2
        // 2) submit foo2
        // 3) apply foo3
        // 4) submit for foo2 failed
        // 5) should not rollback foo2 as it would overwrite foo3
        
        controller.failOnNextSubmit();
        controller.update("foo2", "bar2");
        controller.update("foo3", "bar3");

        await controller.waitForIdle();

        expect(controller.model.foo).toBe("foo3");
        expect(controller.model.bar).toBe("bar3");
        expect(controller.model.revision).toBe(3);
    });

    test("receive an edit event from the stream", async () => { 
        const { controller, store, stream } = createTestContext();

        await controller.update("foo", "bar").then(result => controller.waitForSubmit(result.edit));
        await controller.update("foo", "bar2").then(result => controller.waitForSubmit(result.edit));

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar3");
        const revision = store.addEdit(controller.modelType, controller.model.id, edit);

        const receivedEditResults: IReceivedEditResult[] = [];
        controller.processManager.onEditReceived(result => receivedEditResults.push(result));

        // wait until after the event was pushed so that the background processing of the edit can start
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await controller.waitForIdle();
        
        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar3");
        expect(controller.model.revision).toBe(4);
        expect(edits.length).toBe(4);
        expect(edits[3].edit.type).toBe("update");
        expect(edits[3].edit.data.bar).toBe("bar3");
        expect(edits[3].revision).toBe(4);

        expect(receivedEditResults).toHaveLength(1);
        expect(receivedEditResults[0].success).toBe(true);
        expect(receivedEditResults[0].error).toBeUndefined();
    });

    test("receive an edit event from the stream that has already been applied", async () => { 
        const { controller, store, stream } = createTestContext();

        const appliedEdits: IEditOperation[] = [];
        controller.onEditApplied(result => appliedEdits.push(result.edit));

        const receivedEditResults: IReceivedEditResult[] = [];
        controller.processManager.onEditReceived(result => receivedEditResults.push(result));

        await controller.update("foo", "bar").then(result => controller.waitForSubmit(result.edit));
        await controller.update("foo", "bar2").then(result => controller.waitForSubmit(result.edit));
        
        // only wait until the edit has been applied to simulate an edit bouncing back before the submit queue has finished
        await controller.update("foo", "bar3");

        // wait until after the event was pushed so that the background processing of the edit can start
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            // simulate the last event that was submitted
            edit: Edits.createUpdateTestEdit("foo", "bar3"),
            timestamp: Date.now(),
            // the expected revision at this point will be 4
            revision: 4
        });

        await controller.waitForIdle();
        
        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar3");
        expect(controller.model.revision).toBe(4);
        expect(edits.length).toBe(4);
        expect(edits[3].edit.type).toBe("update");
        expect(edits[3].edit.data.bar).toBe("bar3");
        expect(edits[3].revision).toBe(4);

        expect(appliedEdits).toHaveLength(3);
        expect(receivedEditResults).toHaveLength(1);
        expect(receivedEditResults[0].success).toBe(false);
        expect(receivedEditResults[0].error).toBe("outdated");
    });

    test("receive an edit event from the stream that is for an unknown type", async () => { 
        const { controller, store, stream } = createTestContext();

        await controller.update("foo", "bar").then(result => controller.waitForSubmit(result.edit));
        await controller.update("foo", "bar2").then(result => controller.waitForSubmit(result.edit));
        
        const receivedEditResults: IReceivedEditResult[] = [];
        controller.processManager.onEditReceived(result => receivedEditResults.push(result));

        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit: { type: "unknown", data: { } },
            timestamp: Date.now(),
            // the expected revision at this point will be 4
            revision: 4
        });

        await controller.waitForIdle();
        
        const edits = store.getRecords(controller.modelType, controller.model.id);

        expect(edits.length).toBe(3);
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar2");
        expect(controller.model.revision).toBe(3);

        expect(receivedEditResults).toHaveLength(1);
        expect(receivedEditResults[0].success).toBe(false);
        expect(receivedEditResults[0].applyResult).toBeDefined();
        expect(receivedEditResults[0].error).toBe("apply_failed");
    });

    test("receive edit events from the stream that are out of order", async () => { 
        const { controller, store, stream } = createTestContext();

        // revision 2
        await controller.update("foo", "bar").then(result => controller.waitForSubmit(result.edit));
        // revision 3
        await controller.update("foo", "bar2").then(result => controller.waitForSubmit(result.edit));

        // simulate saving a couple edits to the server
        const edit1 = Edits.createUpdateTestEdit("foo", "bar3");
        // revision 4
        const revision1 = store.addEdit(controller.modelType, controller.model.id, edit1);

        const edit2 = Edits.createAddItemEdit("item");
        // revision 5
        const revision2 = store.addEdit(controller.modelType, controller.model.id, edit2);

        // simulate applying and submitting an edit on the client before receiving the event from the server
        // at this point the server will return revision 6 which will not be sequential to the expected value causing the model to sync
        await controller.update("foo", "bar4").then(result => controller.waitForSubmit(result.edit));

        // push the edits to the client/controller -- the controller is expected to handle keeping things in sync
        stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit: edit1,
            timestamp: Date.now(),
            revision: revision1
        });

        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit: edit2,
            timestamp: Date.now(),
            revision: revision2
        });

        await controller.waitForIdle();

        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar4");
        expect(controller.model.items).toHaveLength(1);
        expect(controller.model.items[0]).toBe("item");
        expect(controller.model.revision).toBe(6);
        expect(edits.length).toBe(6);
        expect(edits[3].edit.type).toBe("update");
        expect(edits[3].edit.data.bar).toBe("bar3");
        expect(edits[3].revision).toBe(4);
        expect(edits[4].edit.type).toBe("addItem");
        expect(edits[4].edit.data.item).toBe("item");
        expect(edits[4].revision).toBe(5);
        expect(edits[5].edit.type).toBe("update");
        expect(edits[5].edit.data.bar).toBe("bar4");
        expect(edits[5].revision).toBe(6);
    });

    test("receive an edit event from the stream for a child model", async () => {
        const { controller, store, stream, createChild } = createTestContext();

        // create a child
        const child = createChild("value");
        await controller.addChild(child.id).then(result => controller.waitForSubmit(result.edit));

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateChildEdit("value2");
        const revision = store.addEdit("child", child.id, edit);

        await stream.pushEvent({ 
            modelType: "child",
            modelId: child.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await controller.waitForIdle();
        
        const childModel = controller.model.children && controller.model.children[0];
        expect(childModel).toBeDefined();
        expect(childModel!.id).toBe(child.id);
        expect(childModel!.value).toBe("value2");
        expect(childModel!.revision).toBe(2);
    });

    test("receive an edit event from the stream to add a child", async () => {
        const { controller, store, stream, createChild } = createTestContext();

        // create a child
        const child = createChild("value");

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createAddChildEdit(child.id);
        const revision = store.addEdit(controller.modelType, controller.model.id, edit);

        // the controller will be expected to fetch the child data and create a child model since the event will only contain the child id
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await controller.waitForIdle();

        const childModel = controller.model.children && controller.model.children[0];
        expect(childModel).toBeDefined();
        expect(childModel!.id).toBe(child.id);
        expect(childModel!.value).toBe("value");
        expect(childModel!.revision).toBe(1);
    });

    test("receive an edit event from the stream for multiple instances sharing the same stream", async () => {
        const context = createTestContext();
        const contexts = [
            context,
            createTestContext(context),
            createTestContext(context),
            createTestContext(context)
        ];

        // simulate saving an edit for the model of the first context and push it from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar");
        const revision = context.store.addEdit(context.controller.modelType, context.controller.model.id, edit);

        // wait until after the event was pushed so that the background processing of the edit can start
        await context.stream.pushEvent({ 
            modelType: context.controller.modelType,
            modelId: context.controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await context.controller.waitForIdle();

        // each controller will have its own queue and own connection to the stream
        expect(context.stream.connectionCount).toBe(4);
        expect(contexts[0].controller.model.foo).toBe("foo");
        expect(contexts[0].controller.model.bar).toBe("bar");
        expect(contexts[1].controller.model.foo).toBeUndefined();
        expect(contexts[1].controller.model.bar).toBeUndefined();
        expect(contexts[2].controller.model.foo).toBeUndefined();
        expect(contexts[2].controller.model.bar).toBeUndefined();
        expect(contexts[3].controller.model.foo).toBeUndefined();
        expect(contexts[3].controller.model.bar).toBeUndefined();
    });

    test("receive an edit event from the stream for multiple instances sharing the same stream after disconnecting", async () => {
        // setup a few contexts that will share the same stream but not the same process manager
        const context = createTestContext();
        const context2 = createTestContext(context);

        const contexts = [
            context,
            context2,
            createTestContext(context),
            createTestContext(context)
        ];

        // simulate saving an edit for the model of the first two contexts and push them from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar");
        const revision = context.store.addEdit(context.controller.modelType, context.controller.model.id, edit);
        const revision2 = context.store.addEdit(context2.controller.modelType, context2.controller.model.id, edit);

        // disconnect the first context from the stream before pushing the event
        context.controller.disconnectStream();

        // push edit to the first context after it has been disconnected
        await context.stream.pushEvent({ 
            modelType: context.controller.modelType,
            modelId: context.controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        // push edit to the second context; it should still be connected to the stream
        await context.stream.pushEvent({ 
            modelType: context2.controller.modelType,
            modelId: context2.controller.model.id,
            edit,
            timestamp: Date.now(),
            revision: revision2
        });

        await Promise.all(contexts.map(context => context.controller.waitForIdle()));

        expect(context.stream.connectionCount).toBe(3);
        expect(contexts[0].controller.model.foo).toBeUndefined();
        expect(contexts[0].controller.model.bar).toBeUndefined();
        expect(contexts[1].controller.model.foo).toBe("foo");
        expect(contexts[1].controller.model.bar).toBe("bar");
        expect(contexts[2].controller.model.foo).toBeUndefined();
        expect(contexts[2].controller.model.bar).toBeUndefined();
        expect(contexts[3].controller.model.foo).toBeUndefined();
        expect(contexts[3].controller.model.bar).toBeUndefined();
    });

    // the tests below test the integration of the EditHistory and EditController
    test("Undo a published edit", async () => {
        const { controller, store } = createTestContext();
        const history = new EditHistory(toEditHistoryPublisher(controller.createApplyPublisher()));
        
        const result1 = await controller.update("foo", "bar");
        const result2 = await controller.update("foo2", "bar2");

        history.push(result1.reverse!);
        history.push(result2.reverse!);

        const undoResult = await history.undo();
        await controller.waitForIdle();

        expect(undoResult).toBeDefined();
        expect(undoResult!.success).toBe(true);

        // just to make sure the history is in the expected state
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(true);

        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(4);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(4);
        expect(edits[3].edit.type).toBe("update");
        expect(edits[3].revision).toBe(4);
    });

    test("Undo an edit after receiving an edit from the stream", async () => {
        const { controller, store, stream } = createTestContext();
        const history = new EditHistory(toEditHistoryPublisher(controller.createApplyPublisher()));

        const result1 = await controller.update("foo", "bar");
        const result2 = await controller.update("foo2", "bar2");

        await controller.waitForSubmit(result1.edit);
        await controller.waitForSubmit(result2.edit);

        history.push(result1.reverse!);
        history.push(result2.reverse!);

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar3");
        const revision = store.addEdit(controller.modelType, controller.model.id, edit);

        // wait until after the event was pushed so that the background processing of the edit can start
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await controller.waitForIdle();
        const snapshot = controller.model.bar;

        // undo after the edit was received from the stream
        const undoResult = await history.undo();
        await controller.waitForIdle();

        expect(undoResult).toBeDefined();
        expect(undoResult!.success).toBe(true);

        // just to make sure the history is in the expected state
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(true);

        // this makes sure the value was updated from the stream as expected
        expect(snapshot).toBe("bar3");
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(5);
    });

    test("Undo and then redo an edit after receiving an edit from the stream", async () => {
        const { controller, store, stream } = createTestContext();
        const history = new EditHistory(toEditHistoryPublisher(controller.createApplyPublisher()));

        const result1 = await controller.update("foo", "bar");
        const result2 = await controller.update("foo2", "bar2");

        await controller.waitForSubmit(result1.edit);
        await controller.waitForSubmit(result2.edit);

        history.push(result1.reverse!);
        history.push(result2.reverse!);

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar3");
        const revision = store.addEdit(controller.modelType, controller.model.id, edit);

        // wait until after the event was pushed so that the background processing of the edit can start
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit,
            timestamp: Date.now(),
            revision
        });

        await controller.waitForIdle();

        const undoResult = await history.undo();
        const redoResult = await history.redo();

        await controller.waitForIdle();

        expect(undoResult).toBeDefined();
        expect(undoResult!.success).toBe(true);

        expect(redoResult).toBeDefined();
        expect(redoResult!.success).toBe(true);

        // just to make sure the history is in the expected state
        expect(history.canUndo()).toBe(true);
        expect(history.canRedo()).toBe(false);

        expect(controller.model.foo).toBe("foo");
        // the undo will set bar back to 'bar' and capture the value of 'bar3' an associate that with the reverse edit
        expect(controller.model.bar).toBe("bar3");
        expect(controller.model.revision).toBe(6);
    });

    test("Undo an unrecognized edit", async () => {
        const { controller, store } = createTestContext();
        const history = new EditHistory(toEditHistoryPublisher(controller.createApplyPublisher()));
        
        await controller.update("foo", "bar");

        history.push({ type: "unknown", data: {} });
        const undoResult = await history.undo();
        await controller.waitForIdle();

        expect(undoResult).toBeDefined();
        expect(undoResult!.success).toBe(true);

        // just to make sure the history will discard the unknown/invalid edit
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);

        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar");
        expect(controller.model.revision).toBe(2);

        const edits = store.getRecords(controller.modelType, controller.model.id);
        expect(edits.length).toBe(2);
        expect(edits[1].edit.type).toBe("update");
        expect(edits[1].revision).toBe(2);
    });
});