import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createHandler } from "./api/handler.js";
import { loadConfig } from "./config/index.js";
import { readOnly } from "./db/types.js";
import { SqliteDatabase } from "./db/sqlite.js";
import { loadDotEnv } from "./env.js";
import { OpenRouterClient } from "./llm/openrouter.js";
import { AppStore } from "./store/index.js";

loadDotEnv();
const config = loadConfig();

const erp = readOnly(SqliteDatabase.open(config.erpDbPath, { readOnly: true }));
const store = new AppStore(SqliteDatabase.open(config.appDbPath));
const llm = config.openRouterApiKey
  ? new OpenRouterClient({ apiKey: config.openRouterApiKey, model: config.openRouterModel })
  : null;

const handler = createHandler({ erp, store, llm, config });

const PUBLIC_DIR = resolve("public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const STATIC_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

async function readBody(req: IncomingMessage, limit = 8_192): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413).end();
        return;
      }
    }
    const response = await handler(
      new Request(url, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter((e): e is [string, string] => typeof e[1] === "string"),
        ),
        body,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  // Static files: resolve inside public/ only, so ../ can never escape it.
  const relative = url.pathname === "/" ? "index.html" : normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  const file = join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + sep) || !MIME[extname(file)]) {
    res.writeHead(404, STATIC_HEADERS).end("Not found");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)]!, ...STATIC_HEADERS }).end(data);
  } catch {
    res.writeHead(404, STATIC_HEADERS).end("Not found");
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`ReportDesk on http://127.0.0.1:${config.port}  (AI ${llm ? "enabled" : "disabled: no OPENROUTER_API_KEY"})`);
});
