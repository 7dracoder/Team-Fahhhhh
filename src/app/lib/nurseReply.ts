import { getAnthropic } from "@/app/lib/anthropic";
import { basetenChat, isBasetenTextConfigured } from "@/app/lib/baseten";
import type { AnalysisEvent } from "@/app/lib/types";

const FALLBACK_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = [
  "You assist nurses/caretakers during an acute event described only by the JSON context.",
  "Answer the follow-up question in 2-6 short sentences: practical immediate checks, when to call EMS, and escalation reminders.",
  "Do not claim a definitive diagnosis. This is decision support only; cite that local protocol and a clinician override your suggestions.",
  "If the question is off-topic, politely redirect to safety and escalation.",
].join(" ");

function buildContext(snapshot: AnalysisEvent): string {
  return JSON.stringify({
    severity: snapshot.severity,
    eventType: snapshot.eventType,
    patientLabel: snapshot.patientLabel,
    summary: snapshot.summary,
    symptoms: snapshot.symptoms,
    confidence: snapshot.confidence,
    sessionId: snapshot.sessionId,
    startTs: snapshot.startTs,
  });
}

/**
 * Short automated triage-style suggestion for a nurse/caretaker follow-up question.
 * Not a substitute for professional judgment or local protocol.
 *
 * Primary path: GPT OSS 120B via Baseten (fast, instruction-tight). Falls back
 * to Anthropic Claude if Baseten is unconfigured or errors.
 */
export async function generateNurseReply(
  snapshot: AnalysisEvent,
  question: string,
): Promise<string> {
  const ctx = buildContext(snapshot);
  const userContent = `Event context (JSON):\n${ctx}\n\nQuestion:\n${question.trim()}`;

  if (isBasetenTextConfigured()) {
    try {
      return await basetenChat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        // Time-sensitive: keep output focused for low latency.
        { maxTokens: 600, temperature: 0.2 },
      );
    } catch (err) {
      console.error(
        "[nurseReply] Baseten failed, falling back to Claude:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const client = getAnthropic();
  const response = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 512,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const block = response.content[0];
  if (block?.type === "text") return block.text.trim();
  return "Unable to generate a reply. Escalate to a clinician or EMS per facility protocol.";
}
