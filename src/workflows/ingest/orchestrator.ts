import { alowareAdapter } from "../../../adapters/aloware.adapter";
import { hubspotAdapter } from "../../../adapters/hubspot.adapter";
import { withinBatchDedup, computeDedupKey } from "../../../ingest/idempotency";
import { ensureDims } from "../../../services/ensure-dims.service";
import { postFactEvents } from "../../../services/post-factevent.service";
import { AdapterResult, IngestEnvelope } from "../../../domain/types";
import { logger } from "../../../config/logger";
import { checkAndMark } from "../../../integrations/idempotency/ledger.repo";
import { loadConfig } from "../../../config/config";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface IngestResult {
  processed: number;
  posted: number;
}

async function loadAlowareSdk(): Promise<any | null> {
  try {
    const abs = path.join(process.cwd(), "sdks/aloware-sdk/src/index");
    const url = pathToFileURL(abs).href;
    return await import(url);
  } catch {
    try {
      // Fallback to relative import if absolute fails
      return await import("../../../sdks/aloware-sdk/src/index");
    } catch {
      return null;
    }
  }
}

export async function handleIngest(envelope: IngestEnvelope): Promise<IngestResult> {
  logger.debug("ingest:start", { source: envelope.source, receivedAt: envelope.receivedAt });
  const adapter: (e: IngestEnvelope) => AdapterResult =
    envelope.source === "ALOWARE" ? alowareAdapter : hubspotAdapter;

  const { events, dimHints } = adapter(envelope);
  logger.debug("ingest:adapter:result", {
    eventsCount: events.length,
    agentIds: dimHints.agentIds?.length ?? 0,
    dates: dimHints.dates?.length ?? 0,
    metrics: dimHints.metrics?.length ?? 0,
  });
  const unique = withinBatchDedup(events);
  if (unique.length !== events.length) {
    logger.debug("ingest:dedup", { before: events.length, after: unique.length });
  }

  // Gate by current Aloware ring group membership (authoritative roster)
  const cfg = loadConfig();
  const ringGroupId = cfg.aloware?.ringGroupId;
  let allowedSet: Set<string> | undefined;
  if (envelope.source === "ALOWARE" && ringGroupId) {
    try {
      const aloware = await loadAlowareSdk();
      const token = process.env.ALOWARE_API_TOKEN;
      if (!token) throw new Error("ALOWARE_API_TOKEN missing");
      if (!aloware?.AlowareClient) throw new Error("Aloware SDK not available");
      const client = new aloware.AlowareClient({ apiToken: token });
      const report = await client.ringGroups.getAvailability({ ringGroupId });
      allowedSet = new Set<string>(report.testResults.map((u: any) => String(u.id)));
      logger.debug("ingest:gate:allowlist", { count: allowedSet.size, ringGroupId });
    } catch (err: any) {
      logger.warn("ingest:gate:error", { message: err?.message || String(err) });
    }
  }

  const allowed = allowedSet
    ? unique.filter((e) => allowedSet!.has(String(e.agentId)))
    : unique;
  if (allowed.length !== unique.length) {
    logger.debug("ingest:gate:filtered", { before: unique.length, after: allowed.length });
  }

  // Cross-request idempotency via DynamoDB ledger
  const gated = [] as typeof allowed;
  for (const ev of allowed) {
    const key = computeDedupKey(envelope.source, ev);
    const isNew = await checkAndMark(key);
    logger.debug("ingest:ledger", { key, isNew });
    if (isNew) gated.push(ev);
  }

  // Rebuild minimal dim hints only from new events
  const newHints = {
    agentIds: Array.from(new Set(gated.map((g) => g.agentId))),
    dates: Array.from(new Set(gated.map((g) => g.factDateKey))),
    metrics: Array.from(new Set(gated.map((g) => g.metricId))),
  };
  await ensureDims(newHints);
  const { posted } = await postFactEvents(gated);

  const result = { processed: gated.length, posted };
  logger.info("ingest:done", result);
  return result;
}

export default handleIngest;


