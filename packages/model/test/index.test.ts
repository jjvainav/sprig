import { IModel, IModelValidation, Model, ModelMap } from "../src";

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

/** Constraints used to validate the item and items child model properties. */
interface ITestModelConstraints {
    readonly itemRequired?: boolean;
    readonly itemsMaxLength?: number;
}

interface ITestModel extends IModel<ITestAttributes> {
    foo: string;
    bar: string;
    baz?: string;
    item?: IItemModel;
    items?: IItemModel[];
}

interface IItemModel extends IModel<IItemAttributes> {
    value: string;
}

class ItemModel extends Model<IItemAttributes> implements IItemModel {
    value: string = "";

    constructor(attributes: IItemAttributes) {
        super(attributes.id);
        this.value = attributes.value;
    }

    protected getValidation(): IModelValidation<IItemAttributes, this> {
        const validateValue = (model: ItemModel) => {
            if (!model.value) {
                model.setErrorMessage("value", "Value is required.");
            }
        };

        return {
            validateAttribute: (model, attribute) => {
                if (attribute === "value") {
                    validateValue(model);
                }
            },
            validateModel: model => validateValue(model)
        };
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
        const constraints = this.constraints || {};
        const validateFoo = (model: TestModel) => {
            if (!model.foo) {
                model.setErrorMessage("foo", "Foo is required.");
            }
        };

        const validateBar = (model: TestModel) => {
            if (!model.bar) {
                model.setErrorMessage("bar", "Bar is required.");
            }
        };

        const validateItem = (model: TestModel) => {
            if (constraints.itemRequired && !model.item) {
                model.setErrorMessage("item", "Item is required.");
            }
        };

        const validateItems = (model: TestModel) => {
            if (constraints.itemsMaxLength && model.items && constraints.itemsMaxLength < model.items.length) {
                model.setErrorMessage("items", `Items length cannot be greater than ${constraints.itemsMaxLength}.`);
            }
        };

        return {
            validateAttribute: (model, attribute) => {
                if (attribute === "foo") {
                    validateFoo(model);
                }
                else if (attribute === "bar") {
                    validateBar(model);
                }
                else if (attribute === "item") {
                    validateItem(model);
                }
                else if (attribute === "items") {
                    validateItems(model);
                }
            },
            validateModel: model => {
                validateFoo(model);
                validateBar(model);
                validateItem(model);
                validateItems(model);
            }
        };
    }
}

describe("model", () => {
    test("create new model", () => {
        const model = new TestModel();
        expect(model.isNew()).toBe(true);
        expect(model.hasError()).toBe(false);
    });

    test("create model from attributes", () => {
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

        expect(model.id).toBe("123");
        expect(model.foo).toBe("foo");
        expect(model.bar).toBe("bar");
        expect(model.item).toBeDefined();
        expect(model.items).toHaveLength(2);

        expect(model.isNew()).toBe(false);
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

    test("validate after correcting error", () => {
        const model: ITestModel = new TestModel({
            id: "123",
            foo: "",
            bar: "bar"
        });

        const result1 = model.validate();
        model.foo = "foo";

        const result2 = model.validate();

        expect(result1).toBe(false);
        expect(result2).toBe(true);
        expect(model.hasError()).toBe(false);
        expect(model.errors.foo).toBeUndefined();
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
        expect(model.hasError("baz")).toBe(false);
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