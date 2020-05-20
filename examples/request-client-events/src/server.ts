import * as bodyParser  from "body-parser";
import * as express from "express";
import * as path from "path";

interface IClient {
    readonly id: number;
    send(data: IMessageData): void;
}

interface IMessageData {
    readonly id: number;
    readonly message: string;
}

let clientId = 1;
let messageId = 1;

const clients = new Map<number, IClient>();
const messages: IMessageData[] = [];

async function start() {
    const app = express();

    app.use(bodyParser.json());
    app.set("port", process.env.PORT || 3000);
    
    app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
    app.get("/messages", (_, res) => res.json({ messages }));
    app.post("/messages", onMessageReceived);
    app.get("/messages/bind", bindClient);
    app.get(/\/public(.*)/, express.static(__dirname, { fallthrough: false }));
    
    app.listen(app.get("port"), () => {
        console.log("  App started at http://localhost:%d", app.get("port"));
        console.log("  App running");
        console.log("  Press CTRL-C to stop\n");
    });
}

function bindClient(req: express.Request, res: express.Response): void {
    res.status(200).set({
        "connection": "keep-alive",
        "cache-control": "no-cache",
        "content-type": "text/event-stream"
    });

    const client: IClient = {
        id: clientId++,
        send: data => res.write(`data: ${JSON.stringify(data)}\n\n`)
    };

    clients.set(client.id, client);
    console.log("client connected:", client.id);

    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    req.on("close", () => {
        clients.delete(client.id);
        console.log("client disconnected:", client.id);
    });

    res.write(":go\n\n");
}

function broadcastMessage(message: IMessageData): void {
    for (const client of clients.values()) {
        client.send(message);
    }
}

function onMessageReceived(req: express.Request, res: express.Response): void {
    if (req.body && typeof req.body.message === "string") {
        const message: IMessageData = { id: messageId++, message: req.body.message };
        messages.push(message);

        res.status(200).json(message);
        setTimeout(() => broadcastMessage(message));
    }
    else {
        res.status(400).json({ error: "Invalid request body." });
    }
}

start();