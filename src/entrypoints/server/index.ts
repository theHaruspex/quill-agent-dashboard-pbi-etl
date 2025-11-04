// Best-effort .env load early in local dev
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch (_) {}

import { createServer, IncomingMessage, ServerResponse } from "http";
import { handleIngest } from "../../index";
import { IngestEnvelope } from "../../domain/types";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || "/";
    const method = req.method || "GET";

    if (method === "GET" && url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (method !== "POST" || !url.startsWith("/webhook/")) {
      return sendJson(res, 404, { error: "Not Found" });
    }

    const parts = url.split("/").filter(Boolean);
    const sourceSegment = parts[1]?.toUpperCase();
    if (sourceSegment !== "ALOWARE" && sourceSegment !== "HUBSPOT") {
      return sendJson(res, 400, { error: "Invalid source. Use /webhook/aloware or /webhook/hubspot" });
    }

    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : undefined;

    const envelope: IngestEnvelope = {
      source: sourceSegment as "ALOWARE" | "HUBSPOT",
      headers: (req.headers as Record<string, string | undefined>) || {},
      body,
      receivedAt: new Date().toISOString(),
    };

    const result = await handleIngest(envelope);
    return sendJson(res, 200, { ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { ok: false, error: message });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`dev server listening on http://localhost:${port}`);
});


