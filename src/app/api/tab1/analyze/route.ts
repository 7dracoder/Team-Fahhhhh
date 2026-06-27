import Anthropic from "@anthropic-ai/sdk";
import { basetenVisionAnalyze, isBasetenVisionConfigured } from "@/app/lib/baseten";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// adjust system prompt later
const SYSTEM_PROMPT = `You are a hospital triage AI analyzing a camera feed. For each visible person output only JSON:
{"patients":[{"id":"tall man blue shirt","location":"brief location","posture":"standing|sitting|lying|slumped","movement":"active|slow|still|none","visible_distress":true|false,"triage":"CRITICAL|URGENT|STABLE|MONITORING","reason":"one sentence","confidence":0.0}]}
The "id" must be a very short 2-4 word physical descriptor (e.g. "elderly woman red jacket", "young man grey hoodie", "child near door"). Never use P1/P2/numbers.
CRITICAL=life threat now, URGENT=needs care soon, STABLE=ok, MONITORING=observe.
No people visible: {"patients":[]}
Return JSON only. No preamble, no markdown fences.`;

const USER_PROMPT = "Analyze this hospital camera frame and triage all visible people.";

function stripFences(text: string): string {
  return text.replace(/^```json\s*/i, "").replace(/```$/m, "").trim();
}

async function analyzeWithClaude(imageBase64: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
  });
  return (response.content[0] as { type: string; text: string }).text;
}

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    // Primary: Gemma 3 27B (vision) via Baseten. Fall back to Claude on error.
    let raw: string;
    if (isBasetenVisionConfigured()) {
      try {
        raw = await basetenVisionAnalyze(imageBase64, USER_PROMPT, {
          systemPrompt: SYSTEM_PROMPT,
          maxTokens: 512,
          temperature: 0.1,
        });
      } catch (err) {
        console.error(
          "[/api/tab1/analyze] Baseten vision failed, falling back to Claude:",
          err instanceof Error ? err.message : err,
        );
        raw = await analyzeWithClaude(imageBase64);
      }
    } else {
      raw = await analyzeWithClaude(imageBase64);
    }

    const text = stripFences(raw);
    return Response.json(JSON.parse(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab1/analyze]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
