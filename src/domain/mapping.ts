import { MetricID } from "./types";

export type AlowareEventType = "outbound_call" | "outbound_text";
export type HubspotEventType = "email_sent" | "case_created";

export const alowareToMetric: Record<AlowareEventType, MetricID> = {
  outbound_call: "CALLS",
  outbound_text: "TEXTS",
};

export const hubspotToMetric: Record<HubspotEventType, MetricID> = {
  email_sent: "EMAILS",
  case_created: "CASES",
};


