import { loadConfig } from "../../config/config";
import { getAccessToken as defaultGetAccessToken, createSdkClient } from "../../integrations/powerbi/powerbi.sdk";
import { logger as defaultLogger, Logger } from "../../config/logger";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface DimAgentRow {
  AgentID: string;
  AgentName: string;
  Email: string;
  TimezoneIANA: string;
  ActiveFlag: boolean;
}

async function loadAlowareSdk(): Promise<any> {
  const abs = path.join(process.cwd(), "sdks/aloware-sdk/src/index");
  const url = pathToFileURL(abs).href;
  return await import(url);
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

async function fetchRingGroupMembers(ringGroupId: number): Promise<DimAgentRow[]> {
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

type FetchMembersFn = (ringGroupId: number) => Promise<DimAgentRow[]>;

type ClearRowsFn = (args: {
  groupId: string;
  datasetId: string;
  accessToken: string;
}) => Promise<void>;

type PushRowsFn = (args: {
  groupId: string;
  datasetId: string;
  rows: DimAgentRow[];
}) => Promise<void>;

type GetAccessTokenFn = (args: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}) => Promise<string>;

export interface DimAgentSyncDependencies {
  fetchMembers?: FetchMembersFn;
  clearRows?: ClearRowsFn;
  pushRows?: PushRowsFn;
  getAccessToken?: GetAccessTokenFn;
}

export interface DimAgentSyncOptions {
  dryRun?: boolean;
  logger?: Logger;
  dependencies?: DimAgentSyncDependencies;
}

export interface DimAgentSyncResult {
  cleared: boolean;
  inserted: number;
  fetched: number;
  dryRun: boolean;
}

export async function syncDimAgentsFromRingGroup(options: DimAgentSyncOptions = {}): Promise<DimAgentSyncResult> {
  const { dryRun = false, dependencies = {}, logger = defaultLogger } = options;

  const cfg = loadConfig();
  const groupId = cfg.powerBi.workspaceId;
  const datasetId = cfg.powerBi.datasetId;
  const ringGroupId = cfg.aloware?.ringGroupId;

  if (!groupId || !datasetId) throw new Error("POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID are required");
  if (!ringGroupId) throw new Error("ALOWARE_RING_GROUP_ID is required in config/env");
  if (!process.env.ALOWARE_API_TOKEN) throw new Error("ALOWARE_API_TOKEN is required");

  const fetchMembers = dependencies.fetchMembers ?? fetchRingGroupMembers;
  const clearRows = dependencies.clearRows ?? (async ({ groupId, datasetId, accessToken }) => {
    await clearDimAgentRows(groupId, datasetId, accessToken);
  });
  const pushRows = dependencies.pushRows ?? (async ({ groupId, datasetId, rows }) => {
    const client = await createSdkClient((msg, ctx) => logger.debug(msg, ctx));
    const sink = client.getPushSink();
    await sink.pushRows({ groupId, datasetId, table: "DimAgent", rows });
  });
  const getAccessToken = dependencies.getAccessToken ?? defaultGetAccessToken;

  logger.info("[dimagent:sync] fetching ring group members", { ringGroupId, dryRun });
  const rows = await fetchMembers(ringGroupId);
  logger.info("[dimagent:sync] fetched roster", { ringGroupId, count: rows.length });

  if (dryRun) {
    logger.info("[dimagent:sync] dry-run: skipping clear/push", { ringGroupId, count: rows.length });
    return { cleared: false, inserted: 0, fetched: rows.length, dryRun: true };
  }

  if (!process.env.POWERBI_TENANT_ID || !process.env.POWERBI_CLIENT_ID || !process.env.POWERBI_CLIENT_SECRET) {
    throw new Error("Missing POWERBI client credentials in env");
  }

  const accessToken = await getAccessToken({
    tenantId: process.env.POWERBI_TENANT_ID!,
    clientId: process.env.POWERBI_CLIENT_ID!,
    clientSecret: process.env.POWERBI_CLIENT_SECRET!,
  });

  await clearRows({ groupId, datasetId, accessToken });
  logger.info("[dimagent:sync] cleared DimAgent table", { datasetId });

  if (rows.length === 0) {
    logger.info("[dimagent:sync] no members to insert; done", { datasetId });
    return { cleared: true, inserted: 0, fetched: 0, dryRun: false };
  }

  await pushRows({ groupId, datasetId, rows });
  logger.info("[dimagent:sync] inserted rows", { datasetId, count: rows.length });

  return { cleared: true, inserted: rows.length, fetched: rows.length, dryRun: false };
}


