import { AdapterResult, FactEventRow, IngestEnvelope, MetricID } from "../domain/types";

function toDateKeyInTz(date: Date, timeZone?: string): string {
  try {
    // Format YYYY-MM-DD in specific IANA timezone using Intl
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value;
        return acc;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function parseCreatedAt(raw?: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    // Accept ISO or "YYYY-MM-DD HH:mm:ss" → coerce to UTC
    const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isOutbound(eventName?: string, direction?: number | null): boolean {
  const name = (eventName || "").toLowerCase();
  if (name.includes("outbound") || name.includes("outgoing")) return true;
  if (name.includes("inbound")) return false;
  // Fallback to direction heuristic: 2 => outbound (assumption), 1 => inbound
  if (direction === 2) return true;
  if (direction === 1) return false;
  return false; // default conservative
}

function inferMetric(eventName?: string, typeCode?: number | null): MetricID {
  const name = (eventName || "").toLowerCase();
  if (name.includes("text") || name.includes("sms")) return "TEXTS";
  if (typeCode === 2) return "TEXTS";
  return "CALLS";
}

export function alowareAdapter(envelope: IngestEnvelope): AdapterResult {
  // Tolerate multiple shapes: direct payload, or { parsedBody: { body, event } }
  const b: any = (envelope.body as any) || {};
  const eventName: string | undefined = b?.event || b?.parsedBody?.event;
  const body: any = b?.body && b?.event ? b.body : b?.parsedBody?.body ?? b;

  const direction: number | null = typeof body?.direction === "number" ? body.direction : null;
  const outbound = isOutbound(eventName, direction);
  if (!outbound) {
    return { events: [], dimHints: { agentIds: [], dates: [], metrics: [] } };
  }

  const metric = inferMetric(eventName, typeof body?.type === "number" ? body.type : null);

  // Identify agent
  const agentId = String(body?.owner_id ?? body?.user_id ?? "unknown");

  // Timezone-aware business date
  const createdAt = parseCreatedAt(body?.created_at) || new Date(envelope.receivedAt);
  const timeZone = body?.contact?.timezone || undefined;
  const factDateKey = toDateKeyInTz(createdAt, timeZone);

  // Deterministic event id from source id
  const srcId = body?.id ?? body?.uuid_v4 ?? `${Date.parse(envelope.receivedAt)}`;
  const eventId = `ALOWARE:${String(srcId)}`;

  const notesPieces: string[] = [];
  if (eventName) notesPieces.push(`event=${eventName}`);
  if (timeZone) notesPieces.push(`tz=${timeZone}`);
  if (!body?.owner_id && !body?.user_id) notesPieces.push("agent=unknown");
  const notes = notesPieces.length ? notesPieces.join(";") : undefined;

  const event: FactEventRow = {
    eventId,
    agentId,
    factDateKey,
    metricId: metric,
    notes,
  };

  return {
    events: [event],
    dimHints: {
      agentIds: [agentId],
      dates: [factDateKey],
      metrics: [metric],
    },
  };
}

export default alowareAdapter;


