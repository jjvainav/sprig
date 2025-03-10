import { EventEmitter, IEvent } from "../src";

describe("event emmitter", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("on event", () => {
        const foo = new Foo();
        let flag = false;
        
        foo.onAChanged(() => flag = true);
        foo.a = "a";

        expect(flag).toBeTruthy();
    });

    test("aggregate with same type", () => {
        const foo = new Foo();
        let count = 0;

        foo.onAChanged.aggregate(foo.onBChanged).on(() => count++);

        foo.a = "a";
        foo.b = "b";
        foo.c = "c";
        foo.d = "d";

        expect(count).toBe(2);
    });

    test("aggregate chain", () => {
        const foo = new Foo();
        let count = 0;

        foo.onAChanged
            .aggregate(
                foo.onBChanged.aggregate(
                foo.onCChanged.aggregate(
                foo.onDChanged)))
            .on(() => count++);

        foo.a = "a";
        foo.b = "b";
        foo.c = "c";
        foo.d = "d";

        expect(count).toBe(4);
    });

    test("aggregate chain and ensure event removal", () => {
        const emitter1 = new EventEmitter();
        const emitter2 = new EventEmitter();
        const emitter3 = new EventEmitter();
        const emitter4 = new EventEmitter();

        let count = 0;
        const aggregatedEvent = emitter1.event.aggregate(
            emitter2.event.aggregate(
            emitter3.event.aggregate(
            emitter4.event)));

        const listener = aggregatedEvent.on(() => count++);

        emitter1.emit();
        emitter2.emit();
        emitter3.emit();
        emitter4.emit();

        listener.remove();

        emitter1.emit();
        emitter2.emit();
        emitter3.emit();
        emitter4.emit();

        expect(count).toBe(4);
        expect(emitter1.count).toBe(0);
        expect(emitter2.count).toBe(0);
        expect(emitter3.count).toBe(0);
        expect(emitter4.count).toBe(0);
    });

    test("aggregate multiple and ensure event removal", () => {
        const emitters: EventEmitter[] = [];
        const baseEmitter = new EventEmitter();
        let aggregatedEvent = baseEmitter.event;

        emitters.push(new EventEmitter());
        emitters.push(new EventEmitter());
        emitters.push(new EventEmitter());
        emitters.push(new EventEmitter());

        emitters.forEach(emitter => aggregatedEvent = aggregatedEvent.aggregate(emitter.event));

        let count = 0;
        const listener = aggregatedEvent.on(() => count++);

        emitters.forEach(emitter => emitter.emit());
        listener.remove();
        emitters.forEach(emitter => emitter.emit());

        expect(count).toBe(4);
        expect(emitters[0].count).toBe(0);
        expect(emitters[1].count).toBe(0);
        expect(emitters[2].count).toBe(0);
        expect(emitters[3].count).toBe(0);
    });

    test("debounce single emit", () => {
        const foo = new Foo();

        let count = 0;
        let value: string | undefined;
        foo.onAChanged.debounce(1).on(() => { 
            count++;
            value = foo.a;
        });

        foo.a = "a";
        foo.a = "b";

        jest.runAllTimers();

        expect(count).toBe(1);
        expect(value).toBe("b");
    });

    test("debounce multiple emit", () => {
        const foo = new Foo();
        const result: string[] = [];

        foo.onAChanged.debounce(1).on(() => result.push(foo.a));

        foo.a = "a"
        foo.a = "b";

        setTimeout(() => { 
            foo.a = "c";
            foo.a = "d";
        }, 2);

        // trigger the first emit
        jest.advanceTimersByTime(2);

        expect(result).toHaveLength(1);
        expect(result[0]).toBe("b");

        // trigger the next foo modification and second debounce
        jest.advanceTimersByTime(1);

        expect(result).toHaveLength(2);
        expect(result[0]).toBe("b");
        expect(result[1]).toBe("d");
    });

    test("debounce with delayed emit", () => {
        const foo = new Foo();

        let count = 0;
        let value: string | undefined;
        foo.onAChanged.debounce(2).on(() => { 
            count++;
            value = foo.a;
        });

        foo.a = "a"
        setTimeout(() => foo.a = "b", 1);
        setTimeout(() => foo.a = "c", 1);
        setTimeout(() => foo.a = "d", 1);
        setTimeout(() => foo.a = "e", 1);
        setTimeout(() => foo.a = "f", 1);
        setTimeout(() => foo.a = "g", 1);
        setTimeout(() => foo.a = "h", 1);

        jest.runAllTimers();

        expect(count).toBe(1);
        expect(value).toBe("h");
    });

    test("debounce multiple event subscriptions", () => {
        const foo = new Foo();
        const result1: string[] = [];
        const result2: string[] = [];
        const result3: string[] = [];

        const event = foo.onAChanged.debounce(2);

        event.on(event => result1.push(event.value));
        event.on(event => result2.push(event.value));
        event.on(event => result3.push(event.value));

        foo.a = "a";
        setTimeout(() => foo.a = "b", 1);
        setTimeout(() => { 
            foo.a = "c";
            foo.a = "d";
        }, 4);

        jest.runAllTimers();

        expect(result1).toHaveLength(2);
        expect(result1[0]).toBe("b");
        expect(result1[1]).toBe("d");

        expect(result2).toHaveLength(2);
        expect(result2[0]).toBe("b");
        expect(result2[1]).toBe("d");

        expect(result3).toHaveLength(2);
        expect(result3[0]).toBe("b");
        expect(result3[1]).toBe("d");
    });

    test("debounce with reducer", () => {
        const foo = new Foo();

        let value: string | undefined;
        foo.onAChanged.debounce(2, (acc, cur) => ({ value: acc.value + cur.value })).on(event => value = event.value);

        foo.a = "a";
        foo.a = "b";
        setTimeout(() => foo.a = "c", 1);

        jest.runAllTimers();

        expect(foo.a).toBe("c");
        expect(value).toBe("abc");
    });

    test("map results", () => {
        const foo = new Foo();

        let result: string;
        foo.onValuesChanged.map(event => event[0].value).on(event => result = event);
        
        foo.begin();
        foo.a = "a";
        foo.end();

        expect(result!).toBe("a");
    });

    test("once", () => {
        const foo = new Foo();

        let count = 0;
        foo.onAChanged.once(() => count++);
        foo.onAChanged.once(() => count++);

        foo.a = "a";
        foo.a = "b";

        expect(count).toBe(2);
    });

    test("once removed before raised", () => {
        const foo = new Foo();

        let count = 0;
        foo.onAChanged.once(() => count++).remove();
    
        foo.a = "a";
        foo.a = "b";

        expect(count).toBe(0);
    });

    test("once with filter", () => {
        const foo = new Foo();

        let count = 0;
        foo.onAChanged.filter(() => foo.a === "b").once(() => count++);

        foo.a = "a";
        expect(count).toBe(0);

        foo.a = "b";
        expect(count).toBe(1);

        foo.a = "c";
        expect(count).toBe(1);
    });

    test("split array results", async () => {
        const foo = new Foo();
        const results: string[] = [];

        foo.onValuesChanged.split(event => event).on(event => results.push(event.value));
        
        foo.begin();
        foo.a = "a";
        foo.b = "b";
        foo.c = "c";
        await foo.end();

        expect(results).toHaveLength(3);
        expect(results[0]).toBe("a");
        expect(results[1]).toBe("b");
        expect(results[2]).toBe("c");
    });

    test("split array with single result", async () => {
        const foo = new Foo();
        const results: string[] = [];
        
        foo.onValuesChanged.split(event => event).on(event => results.push(event.value));

        foo.begin();
        foo.a = "a";
        await foo.end();

        expect(results).toHaveLength(1);
        expect(results[0]).toBe("a");
    });

    test("remove event handler", () => {
        const foo = new Foo();

        let count = 0;
        const event1 = foo.onAChanged(() => count++);
        const event2 = foo.onAChanged(() => count++);

        event1.remove();
        foo.a = "a";

        event2.remove();
        foo.a = "b";

        expect(count).toBe(1);
    });

    test("remove event handler from inside callback", () => {
        const foo = new Foo();

        let count = 0;
        const event1 = foo.onAChanged(() => {
            count++;
            event1.remove();
        });

        const event2 = foo.onAChanged(() => {
            count++;
            event2.remove();
        });

        foo.a = "a";
        foo.a = "b";

        expect(count).toBe(2);
    });

    test("remove event before emit", () => {
        const foo = new Foo();

        let count = 0;
        const event = foo.onAChanged.filter(() => foo.a === "b").once(() => count++);

        event.remove();

        foo.a = "a";
        foo.a = "b";
        foo.a = "c";

        expect(count).toBe(0);
    });

    test("async event callback", async () => {
        const emitter = new EventEmitter("test");
        let flag = false;

        emitter.event.on(() => new Promise(resolve => {
            setTimeout(() => {
                flag = true;
                resolve(flag);
            }, 1);

            jest.runAllTimers();
        }));

        await emitter.emit();

        expect(flag).toBe(true);
    });

    test("async event callback using once", async () => {
        const emitter = new EventEmitter("test");
        let flag = false;

        emitter.event.once(() => new Promise<void>(resolve => {
            setTimeout(() => {
                flag = true;
                resolve();
            }, 1);

            jest.runAllTimers();
        }));

        await emitter.emit();

        expect(flag).toBe(true);
    });

    test("async event callback that fails", async () => {
        const emitter = new EventEmitter("test");

        emitter.event.on(() => new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error("Fail.")), 1);
            jest.runAllTimers();
        }));

        try {
            await emitter.emit();
            fail();
        }
        catch {
        }
    });
});

class Foo {
    private readonly aChanged = new EventEmitter<{ value: string }>("a-changed");
    private readonly bChanged = new EventEmitter<{ value: string }>("b-changed");
    private readonly cChanged = new EventEmitter<{ value: string }>("c-changed");
    private readonly dChanged = new EventEmitter<{ value: string }>("d-changed");
    private readonly valuesChanged = new EventEmitter<{ key: string, value: string }[]>("values-changed");

    private changes: { [key: string]: string } = {};

    get onAChanged(): IEvent<{ value: string }> {
        return this.aChanged.event;
    }

    get onBChanged(): IEvent<{ value: string }> {
        return this.bChanged.event;
    }

    get onCChanged(): IEvent<{ value: string }> {
        return this.cChanged.event;
    }

    get onDChanged(): IEvent<{ value: string }> {
        return this.dChanged.event;
    }

    get onValuesChanged(): IEvent<{ key: string, value: string }[]> {
        return this.valuesChanged.event;
    }

    begin(): void {
        this.changes = {};
    }

    async end(): Promise<void> {
        const result: { key: string, value: string }[] = [];
        Object.keys(this.changes).forEach(key => result.push({ key, value: this.changes[key] }));
        await this.valuesChanged.emit(result);
        this.changes = {};
    }

    private _a = "";
    get a(): string {
        return this._a;
    }

    set a(value: string) {
        if (this._a !== value) {
            this._a = value;
            this.changes["a"] = value;
            this.aChanged.emit({ value });
        }
    }

    private _b = "";
    get b(): string {
        return this._b;
    }

    set b(value: string) {
        if (this._b !== value) {
            this._b = value;
            this.changes["b"] = value;
            this.bChanged.emit({ value });
        }
    }

    private _c = "";
    get c(): string {
        return this._c;
    }

    set c(value: string) {
        if (this._c !== value) {
            this._c = value;
            this.changes["c"] = value;
            this.cChanged.emit({ value });
        }
    }

    private _d = "";
    get d(): string {
        return this._d;
    }

    set d(value: string) {
        if (this._d !== value) {
            this._d = value;
            this.changes["d"] = value;
            this.dChanged.emit({ value });
        }
    }
}