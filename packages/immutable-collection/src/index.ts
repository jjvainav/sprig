import array from "@sprig/immutable-array";

type Primitives = string | number | boolean;
type PropFilterOperator<T, K extends keyof T> = 
    | { $eq: T[K] }
    | { $in: Array<T[K]> }
    | { $ne: T[K] };

type PropFilterValue<T, K extends keyof T> = T[K] | Array<T[K]> | PropFilterOperator<T, K>;
type PropFilterType<T, K extends keyof T> =
    T[K] extends Primitives ? PropFilterValue<T, K> :
    T[K] extends Array<infer U> ? Filter<U> :
    T[K] extends object ? Filter<T[K]> :
    never;

export type Filter<T> = { readonly [K in keyof T]?: PropFilterType<T, K> };
export type FilterKeys<T> = { [K in keyof T]?: T[K] extends Primitives ? K : never }[keyof T];

/** Represents an immutable collection of non-indexed items. */
export interface ICollection<T> {
    delete(filter: Filter<T>): ICollection<T>;
    find(filter: Filter<T>): T | undefined;
    findAll(filter: Filter<T>): T[];
    insert(item: T): ICollection<T>;
    update(filter: Filter<T>, callback: (item: T) => T): ICollection<T>;
}

export function isFilterMatch<T>(item: T, filter: Filter<T>): boolean {
    for (const key of Object.keys(filter)) {
        const filterValue = (<any>filter)[key];

        if (filterValue !== undefined && !isMatch((<any>item)[key], filterValue)) {
            return false;
        }
    }

    return true;
}

function isMatch(propValue: any, filterValue: any): boolean {
    // first check if the item's property value is an array or object and perform a nested or sub-query match

    if (Array.isArray(propValue)) {
        for (const item of propValue) {
            if (isFilterMatch(item, filterValue)) {
                return true;
            }
        }

        return false;
    }
    
    if (typeof propValue === "object") {
        return isFilterMatch(propValue, filterValue);
    }

    // if we get here, the property value is assumed to be a primitive
    // check if the filter value is an array (implicit 'in') or an operator

    if (Array.isArray(filterValue)) {
        return isInMatch(propValue, filterValue);
    }

    if (typeof filterValue === "object") {
        return isOperatorMatch(propValue, filterValue);
    }

    // lastly, if the property and filter values are primitives perform an implied equal
    return isEqMatch(propValue, filterValue);
}

function isOperatorMatch(propValue: any, op: PropFilterOperator<any, any>): boolean {
    const keys = Object.keys(op);

    if (keys.length !== 1) {
        throw new Error("Invalid filter operator");
    }

    const key = keys[0];
    const filterValue = (<any>op)[key];

    switch(key.toLowerCase()) {
        case "$eq": return isEqMatch(propValue, filterValue);
        case "$in": return isInMatch(propValue, filterValue);
        case "$ne": return isNeMatch(propValue, filterValue);
    }

    throw new Error(`Unexpected operator (${key})`);
}

function isEqMatch(propValue: any, filterValue: any): boolean {
    return propValue == filterValue;
}

function isInMatch(propValue: any, filterValue: any[]): boolean {
    return filterValue.indexOf(propValue) > -1;
}

function isNeMatch(propValue: any, filterValue: any): boolean {
    return propValue != filterValue;
}

/** A collection that supports a single unique key for improved efficiency and uses a map internally. */
export class KeyedCollection<T> implements ICollection<T> {
    private readonly items: Map<any, T>;

    constructor(private readonly key: FilterKeys<T>, items: Map<any, T> | T[] = []) {
        if (Array.isArray(items)) {
            this.items = new Map<any, T>();
            items.forEach(item => this.addItem(this.items, item));
        }
        else {
            this.items = items;
        }
    }

    count(filter?: Filter<T>): number {
        if (!filter) {
            return this.items.size;
        }

        if (this.isKeyFilter(filter)) {
            return this.items.has(filter[this.key!]) ? 1 : 0;
        }

        let count = 0;
        for (const item of this.items.values()) {
            if (isFilterMatch(item, filter)) {
                count++;
            }
        }

        return count;
    }

    delete(filter: Filter<T>): KeyedCollection<T> {
        if (this.isKeyFilter(filter)) {
            const items = new Map(this.items);
            items.delete((<any>filter)[this.key]);
            return new KeyedCollection(this.key, items);
        }

        const items: T[] = [];
        for (const item of this.items.values()) {
            if (!isFilterMatch(item, filter)) {
                items.push(item);
            }
        }

        return new KeyedCollection(this.key, items);
    }

    find(filter: Filter<T>): T | undefined {
        if (this.isKeyFilter(filter)) {
            return this.items.get((<any>filter)[this.key]);
        }

        for (const item of this.items.values()) {
            if (isFilterMatch(item, filter)) {
                return item;
            }
        }

        return undefined;
    }

    findAll(filter: Filter<T>): T[] {
        if (this.isKeyFilter(filter)) {
            const item = this.items.get((<any>filter)[this.key]);
            return item ? [item] : [];
        }

        const result: T[] = [];

        for (const item of this.items.values()) {
            if (isFilterMatch(item, filter)) {
                result.push(item);
            }
        }

        return result;
    }

    insert(item: T): KeyedCollection<T> {
        return new KeyedCollection(this.key, [...this.items.values(), item]);
    }

    update(filter: Filter<T>, callback: (item: T) => T): KeyedCollection<T> {
        if (this.isKeyFilter(filter)) {
            const key = (<any>filter)[this.key];
            const value = this.items.get(key);

            if (!value) {
                // nothing to update
                return this;
            }

            // delete and re-add incase the key changed during the update
            const items = new Map(this.items);
            items.delete(key);
            this.addItem(items, callback(value));
            return new KeyedCollection(this.key, items);
        }

        let items = [...this.items.values()];

        for (let i = items.length - 1; i >= 0; i--) {
            if (isFilterMatch(items[i], filter)) {
                items = array.replace(items, i, callback(items[i]));
            }
        }

        return new KeyedCollection(this.key, items);
    }

    toArray(): T[] {
        return [...this.items.values()];
    }

    private addItem(items: Map<any, T>, item: T): void {
        const itemKey = item[this.key!];
        if (items.has(itemKey)) {
            throw new Error("Duplicate key");
        }

        items.set(itemKey, item);
    }

    private isKeyFilter(filter: Filter<T>): boolean {
        if (this.key) {
            const keys = Object.keys(filter);
            return keys.length === 1 && keys[0] === this.key;
        }

        return false;
    }
}

/** A standard collection that uses an array internally. */
export class Collection<T> implements ICollection<T> {
    constructor(private readonly items: T[] = []) {
    }

    count(filter?: Filter<T>): number {
        if (!filter) {
            return this.items.length;
        }

        let count = 0;
        this.items.forEach(item => {
            if (isFilterMatch(item, filter)) {
                count++;
            }
        });

        return count;
    }

    delete(filter: Filter<T>): Collection<T> {
        return this.newCollection(this.items.filter(item => !isFilterMatch(item, filter)));
    }

    find(filter: Filter<T>): T | undefined {
        for (const item of this.items) {
            if (isFilterMatch(item, filter)) {
                return item;
            }
        }

        return undefined;
    }

    findAll(filter: Filter<T>): T[] {
        return this.items.filter(item => isFilterMatch(item, filter));
    }

    insert(item: T): Collection<T> {
        return this.newCollection([...this.items, item]);
    }

    update(filter: Filter<T>, callback: (item: T) => T): Collection<T> {
        let items = this.items;

        for (let i = items.length - 1; i >= 0; i--) {
            if (isFilterMatch(items[i], filter)) {
                items = array.replace(items, i, callback(items[i]));
            }
        }

        return this.newCollection(items);
    }

    toArray(): T[] {
        return this.items;
    }

    protected newCollection(items: T[]): Collection<T> {
        return new Collection(items);
    }
}