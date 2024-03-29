import { AsyncQueue, IAsyncTask } from "../src";

function createTask(value: string, delay = 0, start = () => { }, end = () => { }): IAsyncTask<string> {
    return () => new Promise(resolve => {
        start();
        setTimeout(() => {
            resolve(value);
            end();
        }, delay)
    });
}

describe("sequential async queue", () => {
    test("push single task", async () => {
        const queue = new AsyncQueue<string>();
        const result = await queue.push(createTask("foo"));
        expect(result).toBe("foo");
    });

    test("push multiple tasks immediately", async () => {
        const queue = new AsyncQueue<string>();

        const promises = [
            queue.push(createTask("foo", 10)),
            queue.push(createTask("bar", 0))
        ];

        const results = await Promise.all(promises);

        expect(results[0]).toBe("foo");
        expect(results[1]).toBe("bar");
    });

    test("push multiple tasks immediately and await", async () => {
        const queue = new AsyncQueue<string>();
        let start = "";
        let end = "";

        queue.push(createTask("foo", 10, () => start += "foo", () => end += "foo"));
        const result = await queue.push(createTask("bar", 10, () => start += "bar", () => end += "bar"));
        queue.push(createTask("baz", 0, () => start += "baz", () => end += "baz"));

        expect(result).toBe("bar");
        expect(start).toBe("foobarbaz");
        expect(end).toBe("foobar");
    });

    test("push multiple tasks immediately and await the last task", async () => {
        const queue = new AsyncQueue<string>();
        let start = "";
        let end = "";

        queue.push(createTask("foo", 10, () => start += "foo", () => end += "foo"));
        queue.push(createTask("bar", 10, () => start += "bar", () => end += "bar"));
        // the 'baz' task should not start until the others have ended
        await queue.push(createTask("baz", 0, () => start += "baz", () => end += "baz"));

        expect(start).toBe("foobarbaz");
        expect(end).toBe("foobarbaz");
    });

    test("push multiple tasks immediately and await for idle", async () => {
        const queue = new AsyncQueue<string>();
        let start = "";
        let end = "";

        queue.push(createTask("foo", 10, () => start += "foo", () => end += "foo"));
        queue.push(createTask("bar", 10, () => start += "bar", () => end += "bar"));
        // the 'baz' task should not start until the others have ended
        queue.push(createTask("baz", 0, () => start += "baz", () => end += "baz"));

        await queue.waitForIdle();

        expect(start).toBe("foobarbaz");
        expect(end).toBe("foobarbaz");
    });

    test("push multiple tasks when idle", async () => { 
        const queue = new AsyncQueue<string>();

        const result1 = await queue.push(createTask("foo"));
        expect(result1).toBe("foo");
        expect(queue.isIdle).toBeTruthy();

        const result2 = await queue.push(createTask("bar"));
        expect(result2).toBe("bar");
        expect(queue.isIdle).toBeTruthy();
    });

    test("push multiple tasks and pause", async () => {
        const queue = new AsyncQueue<string>();
        let processing = 0;
        let processed = 0;

        const promises = [
            queue.push(createTask("task 1", 0, () => processing++, () => processed++)),
            queue.push(createTask("task 2", 0, () => processing++, () => processed++)),
            queue.push(createTask("task 3", 0, () => processing++, () => processed++))
        ];

        queue.pause();

        const promises2 = [
            queue.push(createTask("task 4", 0, () => processing++, () => processed++)),
            queue.push(createTask("task 5", 0, () => processing++, () => processed++)),
            queue.push(createTask("task 6", 0, () => processing++, () => processed++))
        ];
    
        // the first batch of tasks should continue to execute
        const results1 = await Promise.all(promises);
        
        expect(results1[0]).toBe("task 1");
        expect(results1[1]).toBe("task 2");
        expect(results1[2]).toBe("task 3");

        expect(processing).toBe(3);
        expect(processed).toBe(3);

        expect(queue.hasPendingTasks()).toBe(true);
        expect(queue.isIdle).toBe(true);
        expect(queue.isPaused).toBe(true);

        queue.resume();

        // the second batch of tasks should start after resuming
        const results2 = await Promise.all(promises2);

        expect(results2[0]).toBe("task 4");
        expect(results2[1]).toBe("task 5");
        expect(results2[2]).toBe("task 6");

        expect(processing).toBe(6);
        expect(processed).toBe(6);

        expect(queue.hasPendingTasks()).toBe(false);
        expect(queue.isIdle).toBe(true);
        expect(queue.isPaused).toBe(false);
    });

    test("push multiple tasks and abort", async () => {
        const queue = new AsyncQueue<string>();
        let processing = 0;

        const promises = [
            queue.push(createTask("task 1", 0, () => processing++, () => queue.abort())),
            queue.push(createTask("task 2", 0, () => processing++)),
            queue.push(createTask("task 3", 0, () => processing++))
        ];
    
        await Promise.all(promises);

        expect(queue.isAborted).toBeTruthy();
        expect(processing).toBe(1);
    });

    test("push task that throws", async () => {
        const queue = new AsyncQueue<string>();
        
        try {
            await queue.push(() => { throw new Error("test") });
            fail();
        }
        catch (err: any) {
            expect((<Error>err).message).toBe("test");
        }
    });

    test("should emit on idle", async () => {
        let idleEvent = 0;
        const queue = new AsyncQueue<string>();
        queue.onIdle(() => idleEvent++);

        expect(queue.isIdle).toBeTruthy();

        const promises = [
            queue.push(createTask("foo")),
            queue.push(createTask("bar"))
        ];

        expect(queue.isIdle).toBeFalsy();
        expect(idleEvent).toBe(0);

        await Promise.all(promises);

        expect(queue.isIdle).toBeTruthy();
        expect(idleEvent).toBe(1);
    });

    test("should execute one task at a time", async () => {
        let processing = 0;
        let max = 0;

        const queue = new AsyncQueue<string>();
        const onEnd = () => processing--;
        const onStart = () => {
            processing++;
            max = Math.max(max, processing);
        };

        const promises = [
            queue.push(createTask("task 1", 10, onStart, onEnd)),
            queue.push(createTask("task 2", 10, onStart, onEnd)),
            queue.push(createTask("task 3", 10, onStart, onEnd))
        ];
    
        await Promise.all(promises);

        expect(processing).toBe(0);
        expect(max).toBe(1);
    });
});

describe("concurrent async queue", () => {
    test("push single task", async () => {
        const queue = new AsyncQueue<string>({ isConcurrent: true });
        const result = await queue.push(createTask("foo"));
        expect(result).toBe("foo");
    });

    test("push multiple tasks immediately", async () => {
        const queue = new AsyncQueue<string>({ isConcurrent: true });

        const promises = [
            queue.push(createTask("foo", 20)),
            queue.push(createTask("bar", undefined))
        ];

        const results = await Promise.all(promises);

        expect(results[0]).toBe("foo");
        expect(results[1]).toBe("bar");
    });

    test("push multiple tasks immediately and wait for idle", async () => {
        const queue = new AsyncQueue<string>({ isConcurrent: true });
        let count = 0;

        queue.push(createTask("foo", 10, () => {}, () => count++));
        queue.push(createTask("bar", 10, () => {}, () => count++));
        queue.push(createTask("baz", undefined, () => {}, () => count++));

        await queue.waitForIdle();

        expect(count).toBe(3);
    });

    test("push multiple tasks immediately and pause", async () => {
        const queue = new AsyncQueue<string>({ isConcurrent: true });
        let processing = 0;
        let processed = 0;

        const promises = [
            queue.push(createTask("task 1", 10, () => processing++, () => processed++)),
            queue.push(createTask("task 2", 10, () => processing++, () => processed++)),
            queue.push(createTask("task 3", undefined, () => processing++, () => processed++))
        ];

        queue.pause();

        const promises2 = [
            queue.push(createTask("task 4", 10, () => processing++, () => processed++)),
            queue.push(createTask("task 5", 10, () => processing++, () => processed++)),
            queue.push(createTask("task 6", undefined, () => processing++, () => processed++))
        ];
    
        // the first batch of tasks should continue to execute
        const results1 = await Promise.all(promises);
        
        expect(results1[0]).toBe("task 1");
        expect(results1[1]).toBe("task 2");
        expect(results1[2]).toBe("task 3");

        expect(processing).toBe(3);
        expect(processed).toBe(3);

        expect(queue.hasPendingTasks()).toBe(true);
        expect(queue.isIdle).toBe(true);
        expect(queue.isPaused).toBe(true);

        queue.resume();

        // the second batch of tasks should start after resuming
        const results2 = await Promise.all(promises2);

        expect(results2[0]).toBe("task 4");
        expect(results2[1]).toBe("task 5");
        expect(results2[2]).toBe("task 6");

        expect(processing).toBe(6);
        expect(processed).toBe(6);

        expect(queue.hasPendingTasks()).toBe(false);
        expect(queue.isIdle).toBe(true);
        expect(queue.isPaused).toBe(false);
    });

    test("all tasks should start at once", async () => {
        let processing = 0;
        let max = 0;

        const queue = new AsyncQueue<string>({ isConcurrent: true });
        const onEnd = () => processing--;
        const onStart = () => {
            processing++;
            max = Math.max(max, processing);
        };

        const promises = [
            queue.push(createTask("task 1", 10, onStart, onEnd)),
            queue.push(createTask("task 2", 10, onStart, onEnd)),
            queue.push(createTask("task 3", 10, onStart, onEnd))
        ];

        await Promise.all(promises);

        expect(processing).toBe(0);
        expect(max).toBe(3);
    });

    test("wait for idle when empty", async () => {
        const queue = new AsyncQueue<string>({ isConcurrent: true });
        await queue.waitForIdle();
        // this is to simply make sure the test does not hang waiting for an empty queue
    });
});