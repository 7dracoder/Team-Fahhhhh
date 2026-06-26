import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// adjust system prompt later
const SYSTEM_PROMPT = `You are a hospital triage AI analyzing a camera feed. For each visible person output only JSON:
{"patients":[{"id":"tall man blue shirt","location":"brief location","posture":"standing|sitting|lying|slumped","movement":"active|slow|still|none","visible_distress":true|false,"triage":"CRITICAL|URGENT|STABLE|MONITORING","reason":"one sentence","confidence":0.0}]}
The "id" must be a very short 2-4 word physical descriptor (e.g. "elderly woman red jacket", "young man grey hoodie", "child near door"). Never use P1/P2/numbers.
CRITICAL=life threat now, URGENT=needs care soon, STABLE=ok, MONITORING=observe.
No people visible: {"patients":[]}
Return JSON only. No preamble, no markdown fences.`;

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

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
            { type: "text", text: "Analyze this hospital camera frame and triage all visible people." },
          ],
        },
      ],
    });

    const text = (response.content[0] as { type: string; text: string }).text
      .replace(/^```json\s*/i, "").replace(/```$/m, "").trim();
    return Response.json(JSON.parse(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab1/analyze]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
