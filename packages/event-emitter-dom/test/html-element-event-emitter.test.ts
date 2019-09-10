import { HTMLElementEventEmitter } from "../src/html-element-event-emitter";

describe("HTML element event emmitter", () => {
    test("on DOM event", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");

        let flag = false;
        click.event(() => flag = true);
        click.bindTarget(el);

        el.click();

        expect(flag).toBeTruthy();
    });

    test("unbind target", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");

        let flag = false;
        click.event(() => flag = true);
        click.bindTarget(el);
        click.unbindTarget();

        el.click();

        expect(flag).toBeFalsy();
    });

    test("bind new target", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");
        const el2 = document.createElement("div");

        let flag = false;
        click.event(() => flag = true);
        click.bindTarget(el);
        click.bindTarget(el2);

        el.click();
        expect(flag).toBeFalsy();

        el2.click();
        expect(flag).toBeTruthy();
    });

    test("remove DOM event", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");

        let flag = false;
        click.event(() => flag = true).remove();
        click.bindTarget(el);

        el.click();

        expect(flag).toBeFalsy();
    });

    test("remove single DOM event", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");

        let flag1 = false;
        let flag2 = false;
        click.event(() => flag1 = true);
        click.event(() => flag2 = true).remove();
        click.bindTarget(el);

        el.click();

        expect((<any>click).count).toBe(1);
        expect(flag1).toBeTruthy();
        expect(flag2).toBeFalsy();
    });

    test("remove all DOM events", () => {
        const click = new HTMLElementEventEmitter("event-name", "click");
        const el = document.createElement("div");

        let flag1 = false;
        let flag2 = false;
        click.event(() => flag1 = true).remove();
        click.event(() => flag2 = true).remove();
        click.bindTarget(el);

        el.click();

        expect((<any>click).count).toBe(0);
        expect(flag1).toBeFalsy();
        expect(flag2).toBeFalsy();
    });    
});