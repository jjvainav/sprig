import { Collection, isFilterMatch, KeyedCollection } from "../src";

interface ITestItem {
    readonly id: string;
    readonly item?: ITestItem;
    readonly items?: ITestItem[];
    readonly value?: string;
    readonly num?: number;
}

describe("filter match", () => {
    test("for single property that matches", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: "1" });
        expect(result).toBeTruthy();
    });

    test("for single property that does not match", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: "2" });
        expect(result).toBeFalsy();
    });

    test("for single property that matches eq operator", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: { $eq: "1" } });
        expect(result).toBeTruthy();
    });

    test("for single property that matches in operator", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: { $in: ["1", "2"] } });
        expect(result).toBeTruthy();
    });

    test("for single property that matches implicit in operator", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: ["1", "2"] });
        expect(result).toBeTruthy();
    });

    test("for single property that matches neq operator", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: { $ne: "2" } });
        expect(result).toBeTruthy();
    });

    test("for multiple properties that match", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: "1", value: "foo" });
        expect(result).toBeTruthy();
    });

    test("for multiple properties that match multiple operators", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: { $eq: "1" }, value: { $in: ["foo"] } });
        expect(result).toBeTruthy();
    });

    test("for multiple properties when one property does not match", () => {
        const value = { id: "1", value: "foo" };
        const result = isFilterMatch(value, { id: "1", value: "bar" });
        expect(result).toBeFalsy();
    });

    test("for nested object with single property that matches", () => {
        const value = { id: "1", item: { value: "foo" } };
        const result = isFilterMatch(value, { item: { value: "foo" } });
        expect(result).toBeTruthy();
    });

    test("for nested object with single property that does not match", () => {
        const value = { id: "1", item: { value: "foo" } };
        const result = isFilterMatch(value, { item: { value: "bar" } });
        expect(result).toBeFalsy();
    });

    test("for nested array with single property that matches", () => {
        const value = { id: "1", items: [{ value: "foo" }, { value: "bar" }] };
        const result = isFilterMatch(value, { items: { value: "foo" } });
        // when a nested property is an array return true as long as at least one item in the array matches
        expect(result).toBeTruthy();
    });

    test("for nested array with single property that does not match", () => {
        const value = { id: "1", items: [{ value: "foo" }, { value: "bar" }] };
        const result = isFilterMatch(value, { items: { value: "hello" } });
        expect(result).toBeFalsy();
    });

    test("for nested array of primitive items that matches", () => {
        const value = { id: "1", items: ["foo", "bar"] };
        const result = isFilterMatch(value, { items: "foo" });
        expect(result).toBeTruthy();
    });

    test("for nested array of primitive items that does not match", () => {
        const value = { id: "1", items: ["foo", "bar"] };
        const result = isFilterMatch(value, { items: "foo-bar" });
        expect(result).toBeFalsy();
    });

    test("for deeply nested array of primitive items that matches", () => {
        const value = { id: "1", inner: { items: ["foo", "bar"] } };
        const result = isFilterMatch(value, { inner: { items: "foo" } });
        expect(result).toBeTruthy();
    });
});

describe("count items in collection", () => {
    test("without filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count();

        expect(count).toBe(3);
    });

    test("with single property filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count({ value: "v1" });

        expect(count).toBe(1);
    });

    test("with multiple property filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const count = collection.count({ value: "v1", num: 2 });

        expect(count).toBe(1);
    });
});

describe("count items in keyed collection", () => {
    test("without filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count();

        expect(count).toBe(3);
    });

    test("with key property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count({ id: "2" });

        expect(count).toBe(1);
    });

    test("with nonexistent key property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count({ id: "4" });

        expect(count).toBe(0);
    });

    test("with single non-key property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const count = collection.count({ value: "v1" });

        expect(count).toBe(1);
    });

    test("with multiple property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const count = collection.count({ value: "v1", num: 2 });

        expect(count).toBe(1);
    });
});

describe("find items in collection", () => {
    test("with single property filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.find({ id: "1" });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });

    test("with single property filter and single value in operator", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.find({ id: ["1"] });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });

    test("with single property filter and multiple value in operator", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.find({ id: ["2", "3"] });

        expect(item).toBeDefined();
        expect(item!.id).toBe("2");
    });

    test("with multiple property filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const item = collection.find({ value: "v1", num: 2 });

        expect(item).toBeDefined();
        expect(item!.id).toBe("2");
    });

    test("with single property nested object filter", () => {
        const collection = new Collection([
            { id: "1", item: { id: "s1", value: "v1" } },
            { id: "2", item: { id: "s2", value: "v2" } },
            { id: "3", item: { id: "s3", value: "v3" } }
        ]);

        const item = collection.find({ item: { id: "s1" } });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });

    test("with single property nested array filter", () => {
        const collection = new Collection([
            { id: "1", items: [{ id: "s1", value: "v1" }, { id: "s12", value: "v12" }] },
            { id: "2", items: [{ id: "s2", value: "v2" }, { id: "s22", value: "v22" }] },
            { id: "3", items: [{ id: "s3", value: "v3" }, { id: "s32", value: "v32" }] }
        ]);

        const item = collection.find({ items: { id: "s12" } });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });

    test("that does not exist", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 }
        ]);

        const item = collection.find({ id: "2" });

        expect(item).toBeUndefined();
    });

    test("with multiple matches", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        // find should return the first item that matches the filter
        const item = collection.find({ value: "v1" });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });
});

describe("find all items in collection", () => {
    test("with single property filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.findAll({ id: "1" });

        expect(item).toHaveLength(1);
        expect(item[0].id).toBe("1");
    });

    test("with single property filter and multiple value in operator", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.findAll({ value: ["v2", "v3"] });

        expect(item).toHaveLength(2);
        expect(item[0].value).toBe("v2");
        expect(item[1].value).toBe("v3");
    });

    test("with single property filter and multiple matches", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v1", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.findAll({ value: "v1" });

        expect(item).toHaveLength(2);
        expect(item[0].id).toBe("1");
        expect(item[1].id).toBe("2");
    });

    test("with single property nested array filter and multiple matches", () => {
        const collection = new Collection([
            { id: "1", items: [{ value: "v1" }, { value: "v2" }] },
            { id: "2", items: [{ value: "v2" }, { value: "v3" }] },
            { id: "3", items: [{ value: "v3" }, { value: "v4" }] }
        ]);

        const item = collection.findAll({ items: { value: "v3" } });

        expect(item).toHaveLength(2);
        expect(item[0].id).toBe("2");
        expect(item[1].id).toBe("3");
    });
});

describe("find items in keyed collection", () => {
    test("with key property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.find({ id: "1" });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });

    test("with single non-key property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 },
            { id: "2", value: "v2", num: 0 },
            { id: "3", value: "v3", num: 0 }
        ]);

        const item = collection.find({ value: "v3" });

        expect(item).toBeDefined();
        expect(item!.id).toBe("3");
    });

    test("with multiple property filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const item = collection.find({ value: "v1", num: 2 });

        expect(item).toBeDefined();
        expect(item!.id).toBe("2");
    });

    test("that does not exist", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 0 }
        ]);

        const item = collection.find({ id: "2" });

        expect(item).toBeUndefined();
    });

    test("with multiple matches", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        // find should return the first item that matches the filter
        const item = collection.find({ value: "v1" });

        expect(item).toBeDefined();
        expect(item!.id).toBe("1");
    });
});

describe("insert items into collection", () => {
    test("when empty", () => {
        const collection = new Collection<ITestItem>();

        const result = collection.insert({ id: "1", value: "v", num: 0 });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(0);
        expect(result.count()).toBe(1);
    });

    test("when not empty", () => {
        const collection = new Collection<ITestItem>([
            { id: "1", value: "v", num: 0 }
        ]);

        const result = collection.insert({ id: "2", value: "v", num: 0 });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(1);
        expect(result.count()).toBe(2);
    });
});

describe("insert items into keyed collection", () => {
    test("when empty", () => {
        const collection = new KeyedCollection<ITestItem>("id");
        
        const result = collection.insert({ id: "1", value: "v", num: 0 });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(0);
        expect(result.count()).toBe(1);
    });

    test("when not empty", () => {
        const collection = new KeyedCollection<ITestItem>("id", [
            { id: "1", value: "v", num: 0 }
        ]);

        const result = collection.insert({ id: "2", value: "v", num: 0 });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(1);
        expect(result.count()).toBe(2);
    });

    test("with duplicate key", () => {
        const collection = new KeyedCollection<ITestItem>("id", [
            { id: "1", value: "v", num: 0 }
        ]);

        expect(() => collection.insert({ id: "1", value: "v", num: 0 })).toThrow();
    });
});

describe("delete items from collection", () => {
    test("with single match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { id: "1" };
        const result = collection.delete(filter);
        const item = result.find(filter);

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(item).toBeUndefined();
        expect(result.count()).toBe(2);
    });

    test("with multiple match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { value: "v1" };
        const result = collection.delete(filter);
        const item = result.find(filter);

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(item).toBeUndefined();
        expect(result.count()).toBe(1);
    });

    test("when item does not exist", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const result = collection.delete({ id: "4" });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(result.count()).toBe(3);
    });
});

describe("delete items from keyed collection", () => {
    test("with key match filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { id: "1" };
        const result = collection.delete(filter);
        const item = result.find(filter);

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(item).toBeUndefined();
        expect(result.count()).toBe(2);
    });

    test("with multiple match filter", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { value: "v1" };
        const result = collection.delete(filter);
        const item = result.find(filter);

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(item).toBeUndefined();
        expect(result.count()).toBe(1);
    });

    test("when item does not exist", () => {
        const collection = new KeyedCollection("id", [
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const result = collection.delete({ id: "4" });

        expect(collection).not.toBe(result);
        expect(collection.count()).toBe(3);
        expect(result.count()).toBe(3);
    });
});

describe("update items in collection", () => {
    test("with single match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { id: "1" };
        const result = collection.update(filter, item => ({ ...item, num: 10 }));
        
        const original = collection.find(filter);
        const updated = result.find(filter);

        expect(collection).not.toBe(result);

        expect(original).toBeDefined();
        expect(original!.num).toBe(1);

        expect(updated).toBeDefined();
        expect(updated!.num).toBe(10);
    });

    test("with multiple match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        let count = 0;
        const filter = { value: "v1" };
        const result = collection.update(filter, item => {
            count++;
            return { ...item, num: 10 };
        });
        
        expect(collection).not.toBe(result);
        expect(count).toBe(2);
    });
});

describe("update items in keyed collection", () => {
    test("with key match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { id: "1" };
        const result = collection.update(filter, item => ({ ...item, num: 10 }));
        
        const original = collection.find(filter);
        const updated = result.find(filter);

        expect(collection).not.toBe(result);

        expect(original).toBeDefined();
        expect(original!.num).toBe(1);

        expect(updated).toBeDefined();
        expect(updated!.num).toBe(10);
    });

    test("with multiple match filter", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        let count = 0;
        const filter = { value: "v1" };
        const result = collection.update(filter, item => {
            count++;
            return { ...item, num: 10 };
        });
        
        expect(collection).not.toBe(result);
        expect(count).toBe(2);
    });

    test("with multiple key match filter using in operator", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const filter = { id: ["1", "2"] };
        const result = collection.update(filter, item => ({ ...item, num: 10 }));
        
        const original = collection.findAll(filter);
        const updated = result.findAll(filter);

        expect(collection).not.toBe(result);

        expect(original).toHaveLength(2);
        expect(original[0].num).toBe(1);
        expect(original[1].num).toBe(2);

        expect(updated).toHaveLength(2);
        expect(updated[0].num).toBe(10);
        expect(updated[1].num).toBe(10);
    });

    test("and change item key", () => {
        const collection = new Collection([
            { id: "1", value: "v1", num: 1 },
            { id: "2", value: "v1", num: 2 },
            { id: "3", value: "v2", num: 3 }
        ]);

        const result = collection.update({ id: "1" }, item => ({ ...item, id: "4" }));
        
        const original = collection.find({ id: "1" });
        const updated = result.find({ id: "4" });

        expect(collection).not.toBe(result);

        expect(original).toBeDefined();
        expect(original!.id).toBe("1");

        expect(updated).toBeDefined();
        expect(updated!.id).toBe("4");
    });
});