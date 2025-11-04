import { alowareAdapter } from "./adapters/aloware.adapter";
import { hubspotAdapter } from "./adapters/hubspot.adapter";
import { withinBatchDedup } from "./ingest/idempotency";
import { ensureDims } from "./services/ensure-dims.service";
import { postFactEvents } from "./services/post-factevent.service";
import { AdapterResult, IngestEnvelope } from "./domain/types";

export interface IngestResult {
  processed: number;
  posted: number;
}

export async function handleIngest(envelope: IngestEnvelope): Promise<IngestResult> {
  const adapter: (e: IngestEnvelope) => AdapterResult =
    envelope.source === "ALOWARE" ? alowareAdapter : hubspotAdapter;

  const { events, dimHints } = adapter(envelope);
  const unique = withinBatchDedup(events);

  await ensureDims(dimHints);
  const { posted } = await postFactEvents(unique);

  return { processed: unique.length, posted };
}

export default handleIngest;


