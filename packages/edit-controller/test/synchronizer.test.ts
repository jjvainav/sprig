import { IEditEvent } from "../src/edit-event";
import { Synchronizer } from "../src/synchronizer";
import { IUpdateTest, TestModel, unixTimestamp } from "./common";

function applyUpdateTestEdit(model: TestModel, event: IEditEvent): Promise<boolean> {
    model.foo = (<IUpdateTest>event.edit).data.foo;
    model.bar = (<IUpdateTest>event.edit).data.bar;
    model.setRevision(event.revision);
    return Promise.resolve(true);
}

function createUpdateTestEditEvent(foo: string, bar: string, revision: number): IEditEvent {
    return {
        edit: {
            type: "update",
            data: { foo, bar }
        },
        timestamp: unixTimestamp(),
        revision
    };
}

describe("synchronizer", () => {
    test("synchronize model with new edits", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [],
            revision: 1
        });

        const event1 = createUpdateTestEditEvent("foo2", "bar2", 2);
        const event2 = createUpdateTestEditEvent("foo3", "bar3", 3);

        const synchronizer = new Synchronizer(
            model, 
            () => Promise.resolve([event1, event2]),
            event => applyUpdateTestEdit(model, event));
       
        await synchronizer.synchronize();

        expect(model.foo).toBe("foo3");
        expect(model.bar).toBe("bar3");
        expect(model.revision).toBe(3);
    });

    test("synchronize model with new edits returned out of order", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [],
            revision: 1
        });

        const event1 = createUpdateTestEditEvent("foo2", "bar2", 2);
        const event2 = createUpdateTestEditEvent("foo3", "bar3", 3);
        const event3 = createUpdateTestEditEvent("foo4", "bar4", 4);

        const synchronizer = new Synchronizer(
            model, 
            () => Promise.resolve([event3, event1, event2]),
            event => applyUpdateTestEdit(model, event));
       
        await synchronizer.synchronize();

        expect(model.foo).toBe("foo4");
        expect(model.bar).toBe("bar4");
        expect(model.revision).toBe(4);
    });

    test("synchronize model with multiple concurrent requests", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [],
            revision: 1
        });

        const results: IEditEvent[] = [
            createUpdateTestEditEvent("foo2", "bar2", 2),
            createUpdateTestEditEvent("foo3", "bar3", 3)
        ];

        let count = 1;
        const synchronizer = new Synchronizer(
            model, 
            (startRevision) => new Promise(resolve => {
                const end = count++;
                // the start revision will be the model's current revision + 1
                setTimeout(() => resolve(results.slice((startRevision || 0) - 2, end)), 0);
            }),
            event => applyUpdateTestEdit(model, event));
       
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
