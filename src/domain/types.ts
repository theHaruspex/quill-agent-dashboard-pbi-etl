export type IngestSource = "ALOWARE" | "HUBSPOT";

export interface IngestEnvelope {
  source: IngestSource;
  headers: Record<string, string | undefined>;
  body: unknown;
  receivedAt: string; // ISO 8601
}

export type MetricID = "CALLS" | "TEXTS" | "EMAILS" | "CASES";

export interface FactEventRow {
  eventId: string; // unique deterministic id from source
  agentId: string;
  factDateKey: string; // YYYY-MM-DD
  metricId: MetricID;
  notes?: string;
}

export interface DimHints {
  agentIds?: string[];
  dates?: string[]; // YYYY-MM-DD
  metrics?: MetricID[];
}

export interface AdapterResult {
  events: FactEventRow[];
  dimHints: DimHints;
}

// Dimensions
export interface DimAgent {
  agentId: string;
  agentName?: string;
  email?: string;
  timezoneIANA?: string;
  activeFlag?: boolean;
}

export interface DimMetric {
  metricId: MetricID;
  metricName?: string;
  defaultGoal?: number;
  defaultYellowFloorPct?: number;
}

export interface DimDate {
  date: string; // YYYY-MM-DD
  year?: number;
  month?: number;
  day?: number;
  monthName?: string;
  quarter?: number;
  dayOfWeek?: number; // 1=Mon .. 7=Sun
  dayName?: string;
  isWeekend?: boolean;
}

export interface DimShift {
  agentId: string;
  localDate: string; // YYYY-MM-DD
  shiftStartLocal?: string; // ISO
  shiftEndLocal?: string; // ISO
  shiftHours?: number;
}


