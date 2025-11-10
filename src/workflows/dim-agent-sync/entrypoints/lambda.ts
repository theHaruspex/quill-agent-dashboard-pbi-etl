// Best-effort .env load in local simulations
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch {}

import { runDimAgentSync } from "../orchestrator";

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
    let dryRun = false;
    if (event.body) {
      try {
        const parsed = JSON.parse(event.body);
        if (parsed && typeof parsed === "object" && "dryRun" in parsed) {
          dryRun = Boolean((parsed as Record<string, unknown>).dryRun);
        }
      } catch (err) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: false, error: "Invalid JSON body" }),
        };
      }
    }

    const result = await runDimAgentSync({ dryRun });
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



