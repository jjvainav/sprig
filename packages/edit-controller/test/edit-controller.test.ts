import { 
    Edits, IChild, ICreateChild, ICreateTest, MockApi, MockEditEventStream, 
    MockEditStore, TestController, TestModel 
} from "./common";

interface ITestContext {
    readonly controller: TestController;
    readonly api: MockApi;
    readonly store: MockEditStore;
    readonly stream: MockEditEventStream;
    createChild(value: string): IChild; 
}

let nextId = 100;
function createTestContext(): ITestContext {
    // the api is used to simulate fetching resource/model objects from a server
    const api = new MockApi();
    // the store is used to store edits for resources/models
    const store = new MockEditStore();
    // the stream is used to simulate pushing events from the server to the client
    const stream = new MockEditEventStream();

    const id = (nextId++).toString();
    const model = new TestModel({ id, items: [], revision: 1 });
    const createEdit: ICreateTest = { type: "create", data: {} };
    const createChild = (value: string) => {
        const child: IChild = { id: (nextId++).toString(), value, revision: 1 };
        const createEdit: ICreateChild = { type: "create", data: { value: child.value } };

        api.children.set(child.id, child);
        store.addEdit("child", child.id, createEdit);
        
        return child;
    };

    // the mock store will auto increment the revision numbers for the edits -- the create edit will have revision 1
    store.addEdit("test", id, createEdit);

    return { controller: new TestController(api, store, model, stream), api, store, stream, createChild };
}

describe("edit controller", () => {
    test("publish edit", async () => {
        const { controller, store } = createTestContext();

        // update will create and publish an update edit
        const publishResult = await controller.update("foo", "bar");

        // publish returns after the edit has been applied but before it has been submitted,
        // this is so the submission can run in the background but if we want to wait we can
        // use the waitForSubmit promise
        //
        // this is usesful so that the browser/ui can remain responsive and if there is a problem
        // submitting, the edit controller will handle synchronizing the model
        const submitResult = await publishResult.waitForSubmit;

        expect(publishResult.success).toBe(true);
        expect(submitResult.success).toBe(true);

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
        const publishResult = await controller.addChild(child.id);
        const submitResult = await publishResult.waitForSubmit;

        expect(publishResult.success).toBe(true);
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

    test("publish multiple edits", async () => { 
        const { controller, store } = createTestContext();

        controller.update("foo", "bar");
        controller.update("foo", "bar2");

        await controller.waitForAllSubmits();

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
        await controller.waitForAllSubmits();

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
        await controller.addChild(child3.id).then(result => result.waitForSubmit);

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

    test("publish edit when revision is behind server revision", async () => { 
        const { controller, store, createChild } = createTestContext();
        const child = createChild("value");

        // add a few edits to the store, these will update the model when the controller attempts to sync with the 'server'
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createUpdateTestEdit("foo", "bar2"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddItemEdit("item"));
        store.addEdit(controller.modelType, controller.model.id, Edits.createAddChildEdit(child.id));

        // at this point the current model is out dated (i.e. edits have been saved on the 'server')
        // edits are applied as 'last-one-wins' regardless of revision but expect the controller to sync the model with stored edits
        await controller.update("foo", "test").then(result => result.waitForSubmit);

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

    test("receive an edit event from the stream", async () => { 
        const { controller, store, stream } = createTestContext();

        // the stream needs to be opened manually
        const connectResult = await controller.connectStream();

        await controller.update("foo", "bar").then(result => result.waitForSubmit);
        await controller.update("foo", "bar2").then(result => result.waitForSubmit);

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateTestEdit("foo", "bar3");
        const revision = store.addEdit(controller.modelType, controller.model.id, edit);

        // just in case, wait for the stream to finish pushing the event otherwise the controller may still be in an idle state
        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit,
            revision
        });

        await controller.waitForIdle();

        const edits = store.getRecords(controller.modelType, controller.model.id);
        
        expect(connectResult.success).toBe(true);
        expect(controller.model.foo).toBe("foo");
        expect(controller.model.bar).toBe("bar3");
        expect(controller.model.revision).toBe(4);
        expect(edits.length).toBe(4);
        expect(edits[3].edit.type).toBe("update");
        expect(edits[3].edit.data.bar).toBe("bar3");
        expect(edits[3].revision).toBe(4);
    });

    test("receive a edit events from the stream that are out of order", async () => { 
        const { controller, store, stream } = createTestContext();

        // the stream needs to be opened manually
        await controller.connectStream();

        await controller.update("foo", "bar").then(result => result.waitForSubmit);
        await controller.update("foo", "bar2").then(result => result.waitForSubmit);

        // simulate saving a couple edits to the server
        const edit1 = Edits.createUpdateTestEdit("foo", "bar3");
        const revision1 = store.addEdit(controller.modelType, controller.model.id, edit1);

        const edit2 = Edits.createAddItemEdit("item");
        const revision2 = store.addEdit(controller.modelType, controller.model.id, edit2);

        // simulate applying and submitting an edit on the client before receiving the event from the server
        await controller.update("foo", "bar4").then(result => result.waitForSubmit);

        // push the edits to the client/controller -- the controller is expected to handle keeping things in sync
        stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit: edit1,
            revision: revision1
        });

        await stream.pushEvent({ 
            modelType: controller.modelType,
            modelId: controller.model.id,
            edit: edit2,
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

        // the stream needs to be opened manually
        await controller.connectStream();

        // create a child
        const child = createChild("value");
        await controller.addChild(child.id).then(result => result.waitForSubmit);

        // simulate saving an edit and pushing it from the server to the client
        const edit = Edits.createUpdateChildEdit("value2");
        const revision = store.addEdit("child", child.id, edit);

        await stream.pushEvent({ 
            modelType: "child",
            modelId: child.id,
            edit,
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

        // the stream needs to be opened manually
        await controller.connectStream();

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
            revision
        });

        await controller.waitForIdle();

        const childModel = controller.model.children && controller.model.children[0];
        expect(childModel).toBeDefined();
        expect(childModel!.id).toBe(child.id);
        expect(childModel!.value).toBe("value");
        expect(childModel!.revision).toBe(1);
    });
});