// Allow using global fetch without DOM lib typings
declare const fetch: any;

import { getAccessToken, PowerBiAuthConfig } from "./powerbi.sdk";

export interface AddRowsRequest<T extends Record<string, unknown>> {
  workspaceId: string;
  datasetId: string;
  table: string;
  rows: T[];
  auth: PowerBiAuthConfig;
  baseUrl?: string;
}

export async function addRows<T extends Record<string, unknown>>(req: AddRowsRequest<T>): Promise<{ count: number }> {
  const token = await getAccessToken(req.auth);
  const baseUrl = req.baseUrl || "https://api.powerbi.com/v1.0/myorg";
  const url = `${baseUrl}/groups/${req.workspaceId}/datasets/${req.datasetId}/tables/${encodeURIComponent(req.table)}/rows`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rows: req.rows }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "<no body>");
    throw new Error(`Power BI addRows failed: ${res.status} ${res.statusText} ${txt}`);
  }
  return { count: req.rows.length };
}


