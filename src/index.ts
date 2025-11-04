import { alowareAdapter } from "./adapters/aloware.adapter";
import { hubspotAdapter } from "./adapters/hubspot.adapter";
import { withinBatchDedup } from "./ingest/idempotency";
import { ensureDims } from "./services/ensure-dims.service";
import { postFactEvents } from "./services/post-factevent.service";
import { AdapterResult, IngestEnvelope } from "./domain/types";
import { logger } from "./config/logger";

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

  await ensureDims(dimHints);
  const { posted } = await postFactEvents(unique);

  const result = { processed: unique.length, posted };
  logger.info("ingest:done", result);
  return result;
}

export default handleIngest;


