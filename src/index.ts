import { alowareAdapter } from "./adapters/aloware.adapter";
import { hubspotAdapter } from "./adapters/hubspot.adapter";
import { withinBatchDedup } from "./ingest/idempotency";
import { ensureDims } from "./services/ensure-dims.service";
import { postFactEvents } from "./services/post-factevent.service";
import { AdapterResult, IngestEnvelope } from "./domain/types";
import { logger } from "./config/logger";
import { checkAndMark } from "./integrations/idempotency/ledger.repo";
import { computeDedupKey } from "./ingest/idempotency";

export interface IngestResult {
  processed: number;
  posted: number;
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

  // Cross-request idempotency via DynamoDB ledger
  const gated = [] as typeof unique;
  for (const ev of unique) {
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


