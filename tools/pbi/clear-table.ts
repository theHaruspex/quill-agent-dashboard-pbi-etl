/*
  Clear rows from a Power BI push dataset table.
  Requirements (.env): POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET, POWERBI_WORKSPACE_ID, POWERBI_DATASET_ID
  Usage:
    npx tsx tools/pbi/clear-table.ts --table FactEvent
    npx tsx tools/pbi/clear-table.ts --table DimAgent --dataset bc15d797-...
*/

try { require("dotenv").config(); } catch (_) {}

import { getAccessToken } from "../../src/integrations/powerbi/powerbi.sdk";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const table = getArg("--table") || "FactEvent";
  const workspaceId = process.env.POWERBI_WORKSPACE_ID;
  const datasetId = getArg("--dataset") || process.env.POWERBI_DATASET_ID;
  if (!workspaceId || !datasetId) throw new Error("POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID are required");

  const tenantId = process.env.POWERBI_TENANT_ID!;
  const clientId = process.env.POWERBI_CLIENT_ID!;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET!;
  if (!tenantId || !clientId || !clientSecret) throw new Error("Missing POWERBI client credentials");

  const token = await getAccessToken({ tenantId, clientId, clientSecret });
  const baseUrl = process.env.PBI_BASE_URL || "https://api.powerbi.com/v1.0/myorg";
  const url = `${baseUrl}/groups/${workspaceId}/datasets/${datasetId}/tables/${encodeURIComponent(table)}/rows`;
  const res = await fetch(url as any, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  } as any);
  if (!res.ok) {
    const txt = await (res as any).text().catch(() => "<no body>");
    throw new Error(`Clear table failed: ${res.status} ${res.statusText} ${txt}`);
  }
  console.log(`Cleared rows for table: ${table}`);
}

main().catch((e) => {
  console.error("[pbi:clear-table] error:", e.message);
  process.exitCode = 1;
});


