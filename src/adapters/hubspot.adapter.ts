import { AdapterResult, FactEventRow, IngestEnvelope, MetricID } from "../domain/types";

function toDateKey(dateIso: string): string {
  return dateIso.slice(0, 10);
}

export function hubspotAdapter(envelope: IngestEnvelope): AdapterResult {
  // Minimal placeholder normalization: generate a single event to prove wiring
  const receivedAt = envelope.receivedAt;
  const metric: MetricID = "EMAILS"; // placeholder default
  const exampleAgent = "unknown@hubspot";
  const eventId = `HUBSPOT:${Date.parse(receivedAt)}`;

  const event: FactEventRow = {
    eventId,
    agentId: exampleAgent,
    factDateKey: toDateKey(receivedAt),
    metricId: metric,
    notes: "example event (scaffold)",
  };

  return {
    events: [event],
    dimHints: {
      agentIds: [exampleAgent],
      dates: [event.factDateKey],
      metrics: [metric],
    },
  };
}

export default hubspotAdapter;


