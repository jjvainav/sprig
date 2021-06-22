import { IEditOperation } from "@sprig/edit-operation";
import { IModelValidation } from "@sprig/model";
import { createValidation } from "@sprig/model-zod";
import * as zod from "zod";
import { EditModel, IEditModel, Synchronizer } from "../src";

interface ITestAttributes {
    readonly id: string;
    readonly foo: string;
    readonly bar: string;
    readonly revision: number;
}

interface ITestModel extends IEditModel<ITestAttributes> {
    foo: string;
    bar: string;
}

interface IUpdateTest extends IEditOperation {
    readonly type: "update";
    readonly data: {
        readonly foo: string;
        readonly bar: string;
    };
}

class TestModel extends EditModel<ITestAttributes> implements ITestModel {
    foo: string = "";
    bar: string = "";

    constructor(attributes: ITestAttributes) {
        super(attributes.id, attributes.revision);
        
        this.foo = attributes.foo;
        this.bar = attributes.bar;

        this.registerHandler("update", (edit: IUpdateTest) => {
            const reverse: IUpdateTest = { 
                type: "update",
                data: { foo: this.foo, bar: this.bar }
            };

            this.foo = edit.data.foo;
            this.bar = edit.data.bar;

            return reverse;
        });
    }

    protected getValidation(): IModelValidation<ITestAttributes, this> {
        return createValidation(zod.object({
            id: zod.string(),
            foo: zod.string().nonempty("Foo is required."),
            bar: zod.string().nonempty("Bar is required."),
            revision: zod.number().min(1, "Revision must be greater than 0.")
        }));
    }
}

describe("edit model", () => {
    test("apply edit", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            revision: 1
        });

        const edit: IUpdateTest = {
            type: "update",
            data: { foo: "foo!", bar: "bar!" }
        };

        const reverse = model.apply(edit);

        expect(reverse).toBeDefined();
        
        expect(model.foo).toBe("foo!");
        expect(model.bar).toBe("bar!");
        expect(model.revision).toBe(2);
    });

    test("apply edit but do not incrememt revision number", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            revision: 1
        });

        const edit: IUpdateTest = {
            type: "update",
            data: { foo: "foo!", bar: "bar!" }
        };

        const reverse = model.apply(edit, { incrementRevision: false });

        expect(reverse).toBeDefined();
        
        expect(model.foo).toBe("foo!");
        expect(model.bar).toBe("bar!");
        expect(model.revision).toBe(1);
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
