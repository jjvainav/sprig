import client from "@sprig/request-client";
import { RequestEventStream } from "@sprig/request-client-events";

const messageCache = new Map();

const header = document.getElementById("header");
header.innerText = "Loading...";

const form = document.getElementById("form");
form.addEventListener("submit", event => {
    const message = document.getElementById("message");
    if (message.value) {
        const submit = document.getElementById("submit");
        const resetForm = () => {
            submit.disabled = false;
            message.value = "";
        };

        submit.disabled = true;
        client.request({ url: "/messages", method: "POST", data: { message: message.value } })
            .invoke()
            .then(() => resetForm())
            .catch(() => resetForm());
    }

    event.preventDefault();
});

client.request({ url: "/messages", method: "GET" }).invoke().then(result => {
    header.innerText = "Messages";
    appendMessages(result.data.messages);
});

const stream = new RequestEventStream({ method: "GET", url: "/messages/bind" });
stream.onMessage(event => appendMessages([event.data]));

function appendMessages(values) {
    const messages = document.getElementById("messages");
    values.forEach(value => {
        if (!messageCache.has(value.id)) {
            const node = document.createElement("div");
            const text = document.createTextNode(value.message);

            node.appendChild(text);
            messages.appendChild(node);

            messageCache.set(value.id, value.message);
        }
    });
}