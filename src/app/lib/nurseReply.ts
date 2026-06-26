import { getAnthropic } from "@/app/lib/anthropic";
import type { AnalysisEvent } from "@/app/lib/types";

const MODEL = "claude-haiku-4-5";

/**
 * Short automated triage-style suggestion for a nurse/caretaker follow-up question.
 * Not a substitute for professional judgment or local protocol.
 */
export async function generateNurseReply(
  snapshot: AnalysisEvent,
  question: string,
): Promise<string> {
  const client = getAnthropic();
  const ctx = JSON.stringify({
    severity: snapshot.severity,
    eventType: snapshot.eventType,
    patientLabel: snapshot.patientLabel,
    summary: snapshot.summary,
    symptoms: snapshot.symptoms,
    confidence: snapshot.confidence,
    sessionId: snapshot.sessionId,
    startTs: snapshot.startTs,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    temperature: 0.2,
    system: [
      "You assist nurses/caretakers during an acute event described only by the JSON context.",
      "Answer the follow-up question in 2–6 short sentences: practical immediate checks, when to call EMS, and escalation reminders.",
      "Do not claim a definitive diagnosis. This is decision support for a demo; cite that local protocol and a clinician override your suggestions.",
      "If the question is off-topic, politely redirect to safety and escalation.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: `Event context (JSON):\n${ctx}\n\nQuestion:\n${question.trim()}`,
      },
    ],
  });

  const block = response.content[0];
  if (block && block.type === "text") return block.text.trim();
  return "Unable to generate a reply. Escalate to a clinician or EMS per facility protocol.";
}
