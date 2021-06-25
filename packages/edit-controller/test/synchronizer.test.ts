import { IEditOperation } from "@sprig/edit-operation";
import { Synchronizer } from "../src/synchronizer";
import { IUpdateTest, TestModel } from "./common";

function applyUpdateTestEdit(model: TestModel, edit: IEditOperation, revision: number): Promise<boolean> {
    model.foo = (<IUpdateTest>edit).data.foo;
    model.bar = (<IUpdateTest>edit).data.bar;
    model.setRevision(revision);
    return Promise.resolve(true);
}

function createUpdateTestEdit(foo: string, bar: string): IUpdateTest {
    return {
        type: "update",
        data: { foo, bar }
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

        const edit1 = createUpdateTestEdit("foo2", "bar2");
        const edit2 = createUpdateTestEdit("foo3", "bar3");

        const synchronizer = new Synchronizer(
            model, 
            () => Promise.resolve([edit1, edit2]),
            (edit, revision) => applyUpdateTestEdit(model, edit, revision));
       
        await synchronizer.synchronize();

        expect(model.foo).toBe("foo3");
        expect(model.bar).toBe("bar3");
        expect(model.revision).toBe(3);
    });

    test("synchronize model with multiple concurrent requests", async () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [],
            revision: 1
        });

        const results: IUpdateTest[] = [
            createUpdateTestEdit("foo2", "bar2"),
            createUpdateTestEdit("foo3", "bar3")
        ];

        let count = 1;
        const synchronizer = new Synchronizer(
            model, 
            (startRevision) => new Promise(resolve => {
                const end = count++;
                // the start revision will be the model's current revision + 1
                setTimeout(() => resolve(results.slice((startRevision || 0) - 2, end)), 0);
            }),
            (edit, revision) => applyUpdateTestEdit(model, edit, revision));
       
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
