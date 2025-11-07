// Best-effort .env load in local simulations
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch {}

import { runDimAgentSync } from "../orchestrator";
import { loadConfig } from "../../../config/config";

interface APIGatewayProxyEventLike {
  headers: Record<string, string | undefined>;
  body: string | null;
}

interface APIGatewayProxyResultLike {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export async function handler(event: APIGatewayProxyEventLike): Promise<APIGatewayProxyResultLike> {
  try {
    const cfg = loadConfig();
    const providedKey = event.headers?.["x-api-key"] || event.headers?.["X-API-Key"];
    if (!cfg.admin?.apiKey || !providedKey || providedKey !== cfg.admin.apiKey) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Unauthorized" }),
      };
    }

    const result = await runDimAgentSync();
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


