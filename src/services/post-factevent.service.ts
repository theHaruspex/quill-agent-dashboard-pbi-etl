import { FactEventRow } from "../domain/types";
import { logger } from "../config/logger";
import { loadConfig } from "../config/config";
import { addRows } from "../integrations/powerbi/tables.repo";

export async function postFactEvents(_rows: FactEventRow[]): Promise<{ posted: number }> {
  logger.debug("facts:post", { count: _rows.length });
  if (_rows.length === 0) return { posted: 0 };

  const cfg = loadConfig();
  const workspaceId = cfg.powerBi.workspaceId;
  const datasetId = cfg.powerBi.datasetId;
  if (!workspaceId || !datasetId) {
    throw new Error("POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID are required to post facts");
  }

  // Map FactEventRow → Power BI row shape (column names per dataset schema)
  const rows = _rows.map((r) => ({
    EventID: r.eventId,
    AgentID: r.agentId,
    FactDateKey: r.factDateKey,
    MetricID: r.metricId,
    Notes: r.notes ?? "",
  }));

  await addRows({
    workspaceId,
    datasetId,
    table: "FactEvent",
    rows,
    auth: {
      tenantId: cfg.powerBi.tenantId || "",
      clientId: cfg.powerBi.clientId || "",
      clientSecret: cfg.powerBi.clientSecret || "",
    },
  });

  return { posted: rows.length };
}

export default postFactEvents;


