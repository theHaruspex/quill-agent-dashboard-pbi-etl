import { loadConfig } from "../../config/config";
import { getAccessToken, createSdkClient } from "../../integrations/powerbi/powerbi.sdk";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadAlowareSdk(): Promise<any> {
  try {
    const abs = path.join(process.cwd(), "sdks/aloware-sdk/src/index");
    const url = pathToFileURL(abs).href;
    return await import(url);
  } catch {
    return await import("../../sdks/aloware-sdk/src/index");
  }
}

async function clearDimAgentRows(groupId: string, datasetId: string, accessToken: string): Promise<void> {
  const baseUrl = process.env.PBI_BASE_URL || "https://api.powerbi.com/v1.0/myorg";
  const table = "DimAgent";
  const url = `${baseUrl}/groups/${groupId}/datasets/${datasetId}/tables/${encodeURIComponent(table)}/rows`;
  const res = await fetch(url as any, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  } as any);
  if (!(res as any).ok) {
    const txt = await (res as any).text().catch(() => "<no body>");
    throw new Error(`Clear DimAgent failed: ${(res as any).status} ${(res as any).statusText} ${txt}`);
  }
}

async function fetchRingGroupMembers(ringGroupId: number) {
  const aloware = await loadAlowareSdk();
  const client = new aloware.AlowareClient({ apiToken: process.env.ALOWARE_API_TOKEN });
  const report = await client.ringGroups.getAvailability({ ringGroupId });
  return report.testResults.map((u: any) => ({
    AgentID: String(u.id),
    AgentName: u.name ?? "",
    Email: u.email ?? "",
    TimezoneIANA: "",
    ActiveFlag: true,
  }));
}

export interface DimAgentSyncResult {
  cleared: boolean;
  inserted: number;
}

export async function syncDimAgentsFromRingGroup(): Promise<DimAgentSyncResult> {
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

  const accessToken = await getAccessToken({
    tenantId: process.env.POWERBI_TENANT_ID!,
    clientId: process.env.POWERBI_CLIENT_ID!,
    clientSecret: process.env.POWERBI_CLIENT_SECRET!,
  });

  await clearDimAgentRows(groupId, datasetId, accessToken);

  const rows = await fetchRingGroupMembers(ringGroupId);
  if (rows.length === 0) {
    return { cleared: true, inserted: 0 };
  }

  const client = await createSdkClient((msg, ctx) => void 0);
  const sink = client.getPushSink();
  await sink.pushRows({ groupId, datasetId, table: "DimAgent", rows });
  return { cleared: true, inserted: rows.length };
}


