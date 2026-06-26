import type { AnalysisEvent } from "@/app/lib/types";

function formatMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Rich plain-text alert for Photon/iMessage: clinical context + reply instructions.
 */
export function buildRichAlertBody(event: AnalysisEvent): string {
  const ts = formatMmSs(event.startTs);
  const symptoms =
    event.symptoms.length > 0 ? event.symptoms.join(", ") : "None listed";
  const confPct = Math.round(event.confidence * 100);
  const sessionLine = event.sessionId
    ? `Live session: ${event.sessionId}`
    : "Live session: (none)";

  return [
    `MEDICAL ALERT — ${event.severity.toUpperCase()}`,
    `Ref: ${event.id}`,
    "",
    `Type: ${event.eventType}`,
    `Patient/area: ${event.patientLabel}`,
    `Video time: ${ts}`,
    sessionLine,
    "",
    `Situation: ${event.summary}`,
    `Signs/symptoms: ${symptoms}`,
    `Model confidence: ${confPct}%`,
    "",
    "You may reply in this thread with up to 2 follow-up questions for brief triage-style suggestions (automated, not a diagnosis).",
    "Escalate to EMS or the attending for any life threat. This is decision support only.",
  ].join("\n");
}
