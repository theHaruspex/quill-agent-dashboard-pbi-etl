/*
  Sync DimAgent from Aloware ring group membership.
  Actions:
    1) DELETE all rows from DimAgent table
    2) INSERT current members from ring group {ALOWARE_RING_GROUP_ID}

  Requirements (.env):
    - POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET
    - POWERBI_WORKSPACE_ID, POWERBI_DATASET_ID
    - ALOWARE_API_TOKEN, ALOWARE_RING_GROUP_ID

  Usage:
    npx tsx tools/admin/sync-dimagents.ts
*/

try { require("dotenv").config(); } catch (_) {}

import { loadConfig } from "../../src/config/config";
import { getAccessToken, createSdkClient } from "../../src/integrations/powerbi/powerbi.sdk";

async function clearDimAgentRows(groupId: string, datasetId: string, accessToken: string) {
  const baseUrl = process.env.PBI_BASE_URL || "https://api.powerbi.com/v1.0/myorg";
  const table = "DimAgent";
  const url = `${baseUrl}/groups/${groupId}/datasets/${datasetId}/tables/${encodeURIComponent(table)}/rows`;
  const res = await fetch(url as any, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  } as any);
  if (!res.ok) {
    const txt = await (res as any).text().catch(() => "<no body>");
    throw new Error(`Clear DimAgent failed: ${res.status} ${res.statusText} ${txt}`);
  }
}

async function fetchRingGroupMembers(ringGroupId: number) {
  const moduleBase = "../../sdks/aloware-sdk/src/";
  const aloware: any = await import(moduleBase + "index");
  const client = new aloware.AlowareClient({ apiToken: process.env.ALOWARE_API_TOKEN });
  const report = await client.ringGroups.getAvailability({ ringGroupId });
  // Map to DimAgent shape
  const rows = report.testResults.map((u: any) => ({
    AgentID: String(u.id),
    AgentName: u.name ?? "",
    Email: u.email ?? "",
    TimezoneIANA: "",
    ActiveFlag: true,
  }));
  return rows;
}

async function main() {
  const cfg = loadConfig();
  const groupId = cfg.powerBi.workspaceId;
  const datasetId = cfg.powerBi.datasetId;
  const ringGroupId = cfg.aloware?.ringGroupId;

  if (!groupId || !datasetId) throw new Error("POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID are required");
  if (!process.env.POWERBI_TENANT_ID || !process.env.POWERBI_CLIENT_ID || !process.env.POWERBI_CLIENT_SECRET) {
    throw new Error("Missing POWERBI client credentials in env");
  }
  if (!process.env.ALOWARE_API_TOKEN) throw new Error("ALOWARE_API_TOKEN is required");
  if (!ringGroupId) throw new Error("ALOWARE_RING_GROUP_ID is required in config/env");

  console.log(`[dimagent:sync] starting for ringGroupId=${ringGroupId}`);

  const accessToken = await getAccessToken({
    tenantId: process.env.POWERBI_TENANT_ID!,
    clientId: process.env.POWERBI_CLIENT_ID!,
    clientSecret: process.env.POWERBI_CLIENT_SECRET!,
  });

  // 1) Clear table
  await clearDimAgentRows(groupId, datasetId, accessToken);
  console.log(`[dimagent:sync] cleared DimAgent in dataset ${datasetId}`);

  // 2) Fetch members
  const rows = await fetchRingGroupMembers(ringGroupId);
  console.log(`[dimagent:sync] fetched ${rows.length} ring group members`);

  if (rows.length === 0) {
    console.log(`[dimagent:sync] no members to insert; done`);
    return;
  }

  // 3) Insert rows via SDK push sink (rate-limited)
  const client = await createSdkClient((msg, ctx) => console.debug(msg, ctx));
  const sink = client.getPushSink();
  await sink.pushRows({ groupId: groupId, datasetId: datasetId, table: "DimAgent", rows });
  console.log(`[dimagent:sync] inserted ${rows.length} rows`);
}

main().catch((err) => {
  console.error("[dimagent:sync] error:", err.message);
  process.exitCode = 1;
});


