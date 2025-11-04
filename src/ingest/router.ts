import { IngestEnvelope, IngestSource } from "../domain/types";

export interface SimpleHttpLikeRequest {
  headers: Record<string, string | undefined>;
  body?: unknown;
}

export function toEnvelope(source: IngestSource, req: SimpleHttpLikeRequest): IngestEnvelope {
  return {
    source,
    headers: req.headers,
    body: req.body,
    receivedAt: new Date().toISOString(),
  };
}


