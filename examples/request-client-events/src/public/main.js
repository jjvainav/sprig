import client from "@sprig/request-client";
import { ReadyState, RequestEventStream } from "@sprig/request-client-events";

let listener;
const messageCache = new Map();

const connection = document.getElementById("connection");
connection.addEventListener("click", () => toggleConnection());

const form = document.getElementById("form");
const message = document.getElementById("message");
const submit = document.getElementById("submit");
form.addEventListener("submit", event => {
    if (message.value) {
        sendMessage(message.value);
        message.value = "";
    }

    event.preventDefault();
});

const stream = new RequestEventStream({ client, method: "GET", url: "/messages/bind" });
stream.onClose(() => setDisconnected());
stream.onError(err => {
    disconnect();
    setDisconnected(); // make sure things are properly cleaned up
    alert(err.message);
});
stream.onOpen(() => {
    loadMessages();
    setConnected();
});

setDisconnected();

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

function connect() {
    connection.disabled = true;
    connection.value = "Connecting...";

    // attaching to the event will automatically connect
    listener = stream.onMessage(event => appendMessages([event.data]));
}

function disconnect() {
    // removing the onMessage event handler will automatically disconnect the stream
    listener.remove();
}

function loadMessages() {
    client.request({ url: "/messages", method: "GET" })
        .invoke()
        .then(result => appendMessages(result.data.messages));
}

function sendMessage(value) {
    client.request({ url: "/messages", method: "POST", data: { message: value } }).invoke();
}

function setConnected() {
    message.disabled = false;
    submit.disabled = false;

    connection.disabled = false;
    connection.value = "Disconnect";
}

function setDisconnected() {
    message.value = "";
    message.disabled = true;
    submit.disabled = true;

    connection.disabled = false;
    connection.value = "Connect";
}

function toggleConnection() {
    if (stream.readyState === ReadyState.open) {
        disconnect();
    }
    else if (stream.readyState === ReadyState.closed) {
        connect();
    }
}