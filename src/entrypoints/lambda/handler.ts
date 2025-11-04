// Best-effort .env load in case of local lambda simulation
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch (_) {}

import { handleIngest } from "../../index";
import { IngestEnvelope } from "../../domain/types";

// Minimal local types to avoid aws-lambda dependency
interface APIGatewayProxyEventLike {
  headers: Record<string, string | undefined>;
  body: string | null;
  pathParameters?: Record<string, string | undefined> | null;
}

interface APIGatewayProxyResultLike {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export async function handler(event: APIGatewayProxyEventLike): Promise<APIGatewayProxyResultLike> {
  try {
    const sourceParam = event.pathParameters?.["source"] || "";
    const upper = sourceParam.toUpperCase();
    if (upper !== "ALOWARE" && upper !== "HUBSPOT") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid source path parameter" }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : undefined;
    const envelope: IngestEnvelope = {
      source: upper as "ALOWARE" | "HUBSPOT",
      headers: event.headers || {},
      body,
      receivedAt: new Date().toISOString(),
    };

    const result = await handleIngest(envelope);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: message }),
    };
  }
}

export default handler;


