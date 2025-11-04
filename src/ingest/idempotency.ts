import { FactEventRow, IngestSource } from "../domain/types";

export function computeDedupKey(source: IngestSource, event: FactEventRow): string {
  return `${source}:${event.eventId}`;
}

export function withinBatchDedup(rows: FactEventRow[]): FactEventRow[] {
  const seen = new Set<string>();
  const deduped: FactEventRow[] = [];
  for (const row of rows) {
    if (seen.has(row.eventId)) continue;
    seen.add(row.eventId);
    deduped.push(row);
  }
  return deduped;
}


