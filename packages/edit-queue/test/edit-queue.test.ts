import "jest";
import { IEditOperation } from "@sprig/edit-operation";
import { EditQueue, IEditDispatcher, IEditTransactionResult } from "../src";

interface IMockEditOperation extends IEditOperation {
    readonly type: "mock";
    readonly delay?: number; 
    readonly error?: Error;
    readonly value?: string;
}

const rejectDispatcher: IEditDispatcher = () => Promise.reject("Edit rejected");
const mockDispatcher: (out?: IEditOperation[]) => IEditDispatcher = out => edit => {
    const amount = (<IMockEditOperation>edit).delay;
    const error = (<IMockEditOperation>edit).error;

    if (out) {
        out.push(edit);
    }

    if (amount === undefined) {
        if (error) {
            throw error;
        }

        return Promise.resolve([{ ...edit }]);
    }

    return delay(() => { 
        if (error) {
            throw error;
        }

        return [{ ...edit }];
    }, amount);
};

function mockEdit(delay?: number, value?: string, error?: Error): IMockEditOperation {
    return { type: "mock", delay, value, error };
}

function assert(done: jest.DoneCallback, callback: () => void): void {
    try {
        callback();
        done();
    }
    catch (error) {
        done.fail(error);
    }
}

function delay<TReturn = void>(fn: () => TReturn, delay: number): Promise<TReturn> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                resolve(fn());
            }
            catch (error) {
                reject(error);
            }
        }, delay);
    });
}

describe("edit queue", () => {
    test("publish edit to channel", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        
        const result = await channel.publish(mockEdit());

        expect(result.isCommitted).toBeTruthy();
        expect(result.isAborted).toBeFalsy();
    });

    test("publish multiple edits to channel", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        const results: string[] = [];
        
        const result1 = await channel.publish(mockEdit(0, "edit 1"));
        results.push((<IMockEditOperation>result1.edits[0]).value!);

        const result2 = await channel.publish(mockEdit(undefined, "edit 2"));
        results.push((<IMockEditOperation>result2.edits[0]).value!);

        expect(results).toHaveLength(2);
        expect(results[0]).toBe("edit 1");
        expect(results[1]).toBe("edit 2");
    });

    test("publish multiple edits to channel as batch", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        const transaction = channel.beginTransaction();

        transaction.publish(mockEdit(undefined, "Edit 1"));
        transaction.publish(mockEdit(undefined, "Edit 2"));
        transaction.publish(mockEdit(undefined, "Edit 3"));

        const result = await transaction.end();

        expect(result.isAborted).toBeFalsy();
        expect(result.isCommitted).toBeTruthy();
        expect(result.edits.length).toBe(3);

        expect((<IMockEditOperation>result.edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>result.edits[1]).value).toBe("Edit 2");
        expect((<IMockEditOperation>result.edits[2]).value).toBe("Edit 3");
    });

    test("publish multiple async edits to channel as batch", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        const transaction = channel.beginTransaction();

        transaction.publish(mockEdit(10, "Edit 1"));
        transaction.publish(mockEdit(0, "Edit 2"));
        transaction.publish(mockEdit(20, "Edit 3"));

        const result = await transaction.end();

        expect(result.isAborted).toBeFalsy();
        expect(result.isCommitted).toBeTruthy();
        expect(result.edits.length).toBe(3);

        expect((<IMockEditOperation>result.edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>result.edits[1]).value).toBe("Edit 2");
        expect((<IMockEditOperation>result.edits[2]).value).toBe("Edit 3");
    });

    test("publish multiple async edits to channel as batch with await", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        const transaction = channel.beginTransaction();

        await transaction.publish(mockEdit(10, "Edit 1"));
        await transaction.publish(mockEdit(0, "Edit 2"));
        await transaction.publish(mockEdit(20, "Edit 3"));

        const result = await transaction.end();

        expect(result.isAborted).toBeFalsy();
        expect(result.isCommitted).toBeTruthy();
        expect(result.edits.length).toBe(3);

        expect((<IMockEditOperation>result.edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>result.edits[1]).value).toBe("Edit 2");
        expect((<IMockEditOperation>result.edits[2]).value).toBe("Edit 3");
    });

    test("publish multiple async edits to transaction scope", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const result = await channel.publish(async transaction => {
            transaction.publish(mockEdit(10, "Edit 1"));
            transaction.publish(mockEdit(0, "Edit 2"));
            transaction.publish(mockEdit(20, "Edit 3"));
        });

        expect(result.isAborted).toBeFalsy();
        expect(result.isCommitted).toBeTruthy();
        expect(result.edits.length).toBe(3);

        expect((<IMockEditOperation>result.edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>result.edits[1]).value).toBe("Edit 2");
        expect((<IMockEditOperation>result.edits[2]).value).toBe("Edit 3");
    });

    test("publish multiple async edits to transaction scope with await", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        let started = 0;
        let ended = 0;
        
        channel.onTransactionStarted(() => started++);
        channel.onTransactionEnded(() => ended++);

        const result = await channel.publish(async transaction => {
            await transaction.publish(mockEdit(10, "Edit 1"));
            await transaction.publish(mockEdit(0, "Edit 2"));
            await transaction.publish(mockEdit(20, "Edit 3"));
        });

        expect(started).toBe(1);
        expect(ended).toBe(1);

        expect(result.isAborted).toBeFalsy();
        expect(result.isCommitted).toBeTruthy();
        expect(result.edits.length).toBe(3);

        expect((<IMockEditOperation>result.edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>result.edits[1]).value).toBe("Edit 2");
        expect((<IMockEditOperation>result.edits[2]).value).toBe("Edit 3");
    });

    test("publish edit while transaction finalizing", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const results: IEditTransactionResult[] = [];
        let count = 0;

        channel.onTransactionStarted(() => count++);
        channel.onTransactionEnded(event => results.push(event.result));

        channel.publish(mockEdit(0, "Edit 1"));

        // the previous transaction should be in a 'finalizing' state at this point
        // publishing a new edit should queue up a new transaction to start after
        // the previous transaction has completed; because of this, we only need
        // to await this transaction and not the last one
        await channel.publish(mockEdit(undefined, "Edit 2"));

        expect(count).toBe(2);
        expect(results.length).toBe(2);

        expect((<IMockEditOperation>results[0].edits[0]).value).toBe("Edit 1");
        expect((<IMockEditOperation>results[1].edits[0]).value).toBe("Edit 2");
    });

    test("publish edits with multiple open transactions", done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();
        const results: IEditOperation[] = [];

        channel.onTransactionEnded(event => {
            results.push(...event.result.edits);

            if (results.length === 2) {
                doAssert();
            }
        });

        const transaction1 = channel.beginTransaction();
        const transaction2 = channel.beginTransaction();

        // transaction1 was started first so even though an edit is published against transaction2 first
        // edits pubished against transaction1 will still be published first
        transaction2.publish(mockEdit(0, "foo"));
        transaction1.publish(mockEdit(0, "bar"));

        transaction2.end();
        transaction1.end();

        const doAssert = () => assert(done, () => {
            expect((<IMockEditOperation>results[0]).value).toBe("bar");
            expect((<IMockEditOperation>results[1]).value).toBe("foo");
        });
    });

    test("publish multiple edits forcing transactions to queue up", async () => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const publishedEdits: IMockEditOperation[] = [];
        let count = 0;

        channel.onTransactionStarted(() => count++);
        channel.onTransactionEnded(event => event.result.edits.forEach(edit => publishedEdits.push(<IMockEditOperation>edit)));

        channel.publish(mockEdit(0, "Edit 1"));
        channel.publish(mockEdit(undefined, "Edit 2"));
        channel.publish(mockEdit(10, "Edit 3"));
        channel.publish(mockEdit(0, "Edit 4"));
        await channel.publish(mockEdit(20, "Edit 5"));

        expect(count).toBe(5);
        expect(publishedEdits.length).toBe(5);

        expect(publishedEdits[0].value).toBe("Edit 1");
        expect(publishedEdits[1].value).toBe("Edit 2");
        expect(publishedEdits[2].value).toBe("Edit 3");
        expect(publishedEdits[3].value).toBe("Edit 4");
        expect(publishedEdits[4].value).toBe("Edit 5");
    });

    test("publish multiple batch edits forcing transactions to queue up", done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const publishedEdits: IMockEditOperation[] = [];
        let count = 0;

        channel.onTransactionStarted(() => count++);
        channel.onTransactionEnded(event => {
            event.result.edits.forEach(edit => publishedEdits.push(<IMockEditOperation>edit));

            if (count === 2) {
                doAssert();
            }
        });

        const transaction1 = channel.beginTransaction();
        transaction1.publish(mockEdit(0, "Edit 1"));
        transaction1.publish(mockEdit(undefined, "Edit 2"));
        transaction1.publish(mockEdit(10, "Edit 3"));
        transaction1.end();

        const transaction2 = channel.beginTransaction();
        transaction2.publish(mockEdit(0, "Edit 4"));
        transaction2.publish(mockEdit(20, "Edit 5"));
        transaction2.end();

        const doAssert = () => assert(done, () => {
            expect(count).toBe(2);
            expect(publishedEdits.length).toBe(5);

            expect(publishedEdits[0].value).toBe("Edit 1");
            expect(publishedEdits[1].value).toBe("Edit 2");
            expect(publishedEdits[2].value).toBe("Edit 3");
            expect(publishedEdits[3].value).toBe("Edit 4");
            expect(publishedEdits[4].value).toBe("Edit 5");
        });
    });

    test("publish multiple batch edits to concurrent transactions", done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const publishedEdits: IMockEditOperation[] = [];
        let count = 0;

        channel.onTransactionStarted(() => count++);
        channel.onTransactionEnded(event => {
            event.result.edits.forEach(edit => publishedEdits.push(<IMockEditOperation>edit));

            if (count === 2) {
                doAssert();
            }
        });

        // transaction1 was started first so all edits published to that
        // transaction will beat out any edits published to transaction2
        const transaction1 = channel.beginTransaction();
        const transaction2 = channel.beginTransaction();
        
        transaction1.publish(mockEdit(0, "Edit 1"));
        transaction2.publish(mockEdit(0, "Edit 4"));
        transaction1.publish(mockEdit(undefined, "Edit 2"));
        transaction1.publish(mockEdit(10, "Edit 3"));
        transaction2.publish(mockEdit(20, "Edit 5"));
        
        transaction2.end();
        transaction1.end();

        const doAssert = () => assert(done, () => {
            expect(count).toBe(2);
            expect(publishedEdits.length).toBe(5);

            expect(publishedEdits[0].value).toBe("Edit 1");
            expect(publishedEdits[1].value).toBe("Edit 2");
            expect(publishedEdits[2].value).toBe("Edit 3");
            expect(publishedEdits[3].value).toBe("Edit 4");
            expect(publishedEdits[4].value).toBe("Edit 5");
        });
    });

    test("publish multiple batch edits to transaction scope forcing transactions to queue up", done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        const publishedEdits: IMockEditOperation[] = [];
        let count = 0;

        channel.onTransactionStarted(() => count++);
        channel.onTransactionEnded(event => {
            event.result.edits.forEach(edit => publishedEdits.push(<IMockEditOperation>edit));

            if (count === 2) {
                doAssert();
            }
        });

        channel.publish(async transaction => {
            transaction.publish(mockEdit(0, "Edit 1"));
            transaction.publish(mockEdit(undefined, "Edit 2"));
            transaction.publish(mockEdit(10, "Edit 3"));
        });

        channel.publish(async transaction => {
            transaction.publish(mockEdit(0, "Edit 4"));
            transaction.publish(mockEdit(20, "Edit 5"));
        });

        const doAssert = () => assert(done, () => {
            expect(count).toBe(2);
            expect(publishedEdits.length).toBe(5);

            expect(publishedEdits[0].value).toBe("Edit 1");
            expect(publishedEdits[1].value).toBe("Edit 2");
            expect(publishedEdits[2].value).toBe("Edit 3");
            expect(publishedEdits[3].value).toBe("Edit 4");
            expect(publishedEdits[4].value).toBe("Edit 5");
        });
    });

    test("publish edit that throws", done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        channel.onTransactionEnded(event => doAssert(event.result));
        channel.publish(mockEdit(0, "", new Error()));

        const doAssert = (result: IEditTransactionResult) => assert(done, () => {
            expect(result.isCommitted).toBeFalsy();
            expect(result.isAborted).toBeTruthy();
        });
    });

    test("publish batch edits that throw", done => {
        const edits: IEditOperation[] = [];
        const queue = new EditQueue(mockDispatcher(edits));
        const channel = queue.createChannel();

        channel.onTransactionEnded(event => doAssert(event.result));

        const transaction = channel.beginTransaction();
        transaction.publish(mockEdit(0, "Edit 1"));
        transaction.publish(mockEdit(0, "Edit 2"));
        transaction.publish(mockEdit(0, "Edit 3", new Error()));
        transaction.end();

        const doAssert = (result: IEditTransactionResult) => assert(done, () => {
            expect(result.isAborted).toBeTruthy();
            expect(result.isCommitted).toBeFalsy();

            // the first 2 edits were successful
            expect(result.edits.length).toBe(2);
            expect(result.reverse.length).toBe(2);

            // the dispatcher should have executed 5 edits, the 3 that were published and the first 2 rolled back.
            expect(edits.length).toBe(5);

            expect((<IMockEditOperation>edits[0]).value).toBe("Edit 1");
            expect((<IMockEditOperation>edits[1]).value).toBe("Edit 2");
            expect((<IMockEditOperation>edits[2]).value).toBe("Edit 3");
            expect((<IMockEditOperation>edits[3]).value).toBe("Edit 2");
            expect((<IMockEditOperation>edits[4]).value).toBe("Edit 1");
        });
    });

    test("publish edit and throw from store", done => {
        const queue = new EditQueue(rejectDispatcher);
        const channel = queue.createChannel();
        
        channel.onTransactionEnded(event => doAssert(event.result));
        channel.publish(mockEdit(0));

        const doAssert = (result: IEditTransactionResult) => assert(done, () => {
            expect(result.isCommitted).toBeFalsy();
            expect(result.isAborted).toBeTruthy();
        });
    });

    test("publish and throw from transaction scope", async done => {
        const queue = new EditQueue(mockDispatcher());
        const channel = queue.createChannel();

        channel.onTransactionEnded(event => doAssert(event.result));

        await expect(channel.publish(async transaction => {
            await transaction.publish(mockEdit(10, "Edit 1"));
            throw new Error("foo");
        })).rejects.toThrowError("foo");

        // if an error is thrown from within a transaction scope the transaction
        // is expected to rollback (abort) and the publish promise to reject

        const doAssert = (result: IEditTransactionResult) => assert(done, () => {
            expect(result.isAborted).toBeTruthy();
        });
    });
});