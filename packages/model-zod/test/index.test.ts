import { IModel, IModelValidation, Model, ModelMap } from "@sprig/model";
import * as zod from "zod";
import { createValidation } from "../src";

interface ITestAttributes {
    readonly id: string;
    readonly foo: string;
    readonly bar: string;
    readonly baz?: string;
    readonly item?: IItemModel;
    readonly items?: IItemModel[];
}

interface IItemAttributes {
    readonly id: string;
    readonly value: string;
}

interface ITestModel extends IModel<ITestAttributes> {
    foo: string;
    bar: string;
    baz?: string;
    item?: IItemModel;
    items?: IItemModel[];
}

/** Constraints used to validate the item and items child model properties. */
interface ITestModelConstraints {
    readonly itemRequired?: boolean;
    readonly itemsMaxLength?: number;
    readonly itemMustExistInArray?: boolean;
}

interface IItemModel extends IModel<IItemAttributes> {
    value: string;
}

class ItemModel extends Model<IItemAttributes> implements IItemModel {
    value: string;

    constructor(attributes: IItemAttributes) {
        super(attributes.id);
        this.value = attributes.value;
    }

    protected getValidation(): IModelValidation<IItemAttributes, this> {
        return createValidation(zod.object({
            id: zod.string(),
            value: zod.string().nonempty("Value is required.")
        }));
    }
}

class TestModel extends Model<ITestAttributes> implements ITestModel {
    foo: string = "";
    bar: string = "";
    baz?: string;
    item?: IItemModel;
    items?: IItemModel[];

    constructor(attributes?: ITestAttributes, private readonly constraints?: ITestModelConstraints) {
        super(attributes && attributes.id);

        if (attributes) {
            this.foo = attributes.foo;
            this.bar = attributes.bar;
            this.baz = attributes.baz;
            this.item = attributes.item;
            this.items = attributes.items;
        }
    }

    protected getChildren(): ModelMap<ITestAttributes> {
        return { item: this.item, items: this.items };
    }

    protected getValidation(): IModelValidation<ITestAttributes, this> {
        let shape = {
            id: zod.string(),
            foo: zod.string().nonempty("Foo is required."),
            bar: zod.string().nonempty("Bar is required."),
            baz: zod.string().optional(),
            item: zod.any().optional(),
            items: zod.array(zod.any()).optional()
        };

        if (this.constraints && this.constraints.itemRequired) {
            shape = <any>{ 
                ...shape, 
                item: zod.any().refine(val => !!val, {
                    message: "Item is required."
                })
            };
        }

        if (this.constraints && this.constraints.itemsMaxLength) {
            shape = <any>{ 
                ...shape, 
                items: zod.array(zod.any()).max(
                    this.constraints.itemsMaxLength, 
                    `Items length cannot be greater than ${this.constraints.itemsMaxLength}.`) 
            };
        }

        if (this.constraints && this.constraints.itemMustExistInArray) {
            const itemExistsInArray = (attributes: ITestAttributes) => {
                if (attributes.item && attributes.items) {
                    for (const item of attributes.items) {
                        if (attributes.item.id === item.id) {
                            return true;
                        } 
                    }
                }

                return false;
            };

            return createValidation(zod.object(shape).refine(data => itemExistsInArray(data), {
                message: "Item must exist in items array.",
                path: ["items"]
            }));
        }

        return createValidation(zod.object(shape));
    }
}

describe("model with zod validation", () => {
    test("validate new model", () => {
        const model = new TestModel();

        model.foo = "foo";
        model.bar = "bar";

        const result = model.validate();

        expect(result).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("validate with valid data", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item: new ItemModel({ id: "1", value: "child 1" }),
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "child 3" })
            ]
        });

        const result = model.validate();

        expect(result).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("validate with invalid data", () => {
        const model = new TestModel({
            id: "123",
            foo: "",
            bar: "bar"
        });

        const result = model.validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.errors.foo).toBe("Foo is required.");
    });

    test("validate with invalid child data", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item: new ItemModel({ id: "1", value: "" }),
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "child 3" })
            ]
        });

        const result = model.validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.hasError("baz")).toBe(false);
        expect(model.item!.errors.value).toBe("Value is required.");
    });

    test("validate with invalid child array data", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item: new ItemModel({ id: "1", value: "child 1" }),
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "" })
            ]
        });

        const result = model.validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.items![1].errors.value).toBe("Value is required.");
    });

    test("validate child directly and ensure parent has error", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item: new ItemModel({ id: "1", value: "child 1" }),
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "" })
            ]
        });

        const result = model.items![1].validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.items![1].errors.value).toBe("Value is required.");
    });

    test("validate after setting a valid value for a currently invalid attribute", () => {
        const model = new TestModel({
            id: "123",
            foo: "",
            bar: "bar"
        });

        model.validate();
        model.foo = "foo";

        const result = model.validate();

        expect(result).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("validate after setting a valid value for a currently invalid child model attribute", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "" })
            ]
        });

        model.validate();
        model.items![1].value = "child 3";

        const result = model.validate();

        expect(result).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("validate a single attribute with valid data", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar"
        });

        const result = model.validate("bar");

        expect(result).toBe(true);
        // even though foo is invalid the validation check for 'bar' should not trigger an error for 'foo'
        expect(model.hasError()).toBe(false);
    });

    test("validate a single attribute with invalid data", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar"
        });

        const result = model.validate("foo");

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.errors.foo).toBe("Foo is required.");
    });

    test("validate a single attribute that is a child model that is valid", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar",
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "child 3" })
            ]
        });

        const result = model.validate("items");

        expect(result).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("validate a single attribute that is a child model with an invalid attribute", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar",
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "" })
            ]
        });

        const result = model.validate("items");

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.items![1].errors.value).toBe("Value is required.");
    });

    test("validate a single attribute when validation schema has a refinement", () => {
        const item = new ItemModel({ id: "1", value: "value" });
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar",
            item,
            items: [item]
        },
        { itemMustExistInArray: true });

        const result = model.validate("bar");

        expect(result).toBe(true);
        // even though foo is invalid the validation check for 'bar' should not trigger an error for 'foo'
        expect(model.hasError()).toBe(false);
    });

    test("validate a single attribute that generates an error from a rule created by a refinement", () => {
        const item = new ItemModel({ id: "1", value: "value" });
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item,
            items: []
        },
        { itemMustExistInArray: true });

        const result = model.validate("items");

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.errors.items).toBe("Item must exist in items array.");
    });

    test("validate with child model attribute that is invalid", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "child 3" })
            ]
        }, {
            itemRequired: true
        });

        const result = model.validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.errors.item).toBe("Item is required.");
    });

    test("validate with child model array attribute that is invalid", () => {
        const model = new TestModel({
            id: "123",
            foo: "foo",
            bar: "bar",
            item: new ItemModel({ id: "1", value: "child 1" }),
            items: [
                new ItemModel({ id: "2", value: "child 2" }),
                new ItemModel({ id: "3", value: "child 3" })
            ]
        }, {
            itemRequired: true,
            itemsMaxLength: 1
        });

        const result = model.validate();

        expect(result).toBe(false);
        expect(model.hasError()).toBe(true);
        expect(model.errors.items).toBe("Items length cannot be greater than 1.");
    });
});