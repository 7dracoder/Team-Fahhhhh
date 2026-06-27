import { basetenChat, isBasetenTextConfigured } from "@/app/lib/baseten";
import { getAnthropic } from "@/app/lib/anthropic";
import type { AnalysisEvent, LiveSession } from "@/app/lib/types";

const FALLBACK_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = [
  "You are a clinical scribe generating a concise shift-handoff note from an automated patient-monitoring session.",
  "The input is JSON: session metadata plus a chronological list of detected events (each with timestamp in session seconds, severity, type, summary, symptoms, confidence).",
  "Produce a handoff note a nurse can read in under 30 seconds, using exactly these plain-text sections with these headers:",
  "PATIENT — one line: label and monitoring window.",
  "CURRENT STATUS — one or two sentences on the latest / most relevant state.",
  "KEY EVENTS — bullet list (use '- '), each: [mm:ss] severity — what happened. Only notable events (urgent/critical first, then moderate). Skip routine 'normal' noise.",
  "RECOMMENDED FOLLOW-UPS — 2 to 4 short, actionable bullets.",
  "Be factual and grounded only in the provided data. Do not invent vitals or diagnoses. This is decision support, not a diagnosis; a clinician and local protocol take precedence.",
  "Output plain text only. No markdown headers (#), no preamble, no closing remarks.",
].join(" ");

function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function buildContext(session: LiveSession, events: AnalysisEvent[]): string {
  return JSON.stringify({
    session: {
      id: session.id,
      patientLabel: session.patientLabel ?? "Patient",
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
    },
    eventCount: events.length,
    events: events.map((e) => ({
      time: formatTimestamp(e.startTs),
      severity: e.severity,
      eventType: e.eventType,
      summary: e.summary,
      symptoms: e.symptoms,
      confidence: e.confidence,
    })),
  });
}

/**
 * Generate a nurse shift-handoff summary for a live monitoring session.
 *
 * Primary path: GPT OSS 120B via Baseten. Falls back to Claude when Baseten is
 * unconfigured or errors.
 */
export async function generateHandoffSummary(
  session: LiveSession,
  events: AnalysisEvent[],
): Promise<string> {
  const ctx = buildContext(session, events);
  const userContent = `Monitoring session data (JSON):\n${ctx}\n\nWrite the shift-handoff note.`;

  if (isBasetenTextConfigured()) {
    try {
      return await basetenChat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { maxTokens: 700, temperature: 0.3 },
      );
    } catch (err) {
      console.error(
        "[handoffSummary] Baseten failed, falling back to Claude:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const client = getAnthropic();
  const response = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 900,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  const block = response.content[0];
  if (block?.type === "text") return block.text.trim();
  return "Unable to generate a handoff summary. Review the event log manually.";
}
