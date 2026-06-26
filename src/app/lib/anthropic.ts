import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 5,
    });
  }
  return _client;
}

const MODEL = "claude-haiku-4-5";

export interface FrameInput {
  base64: string;
  timestamp: number;
}

function extractText(response: Anthropic.Messages.Message): string {
  const block = response.content[0];
  if (block && block.type === "text") return block.text;
  return "";
}

export async function analyzeFrame(imageBase64: string, prompt: string): Promise<string> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return extractText(response);
}

export async function analyzeFrameBatch(
  frames: FrameInput[],
  prompt: string,
): Promise<string> {
  if (frames.length === 0) throw new Error("analyzeFrameBatch requires at least one frame");
  const client = getAnthropic();

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const frame of frames) {
    content.push({
      type: "text",
      text: `Frame at t=${frame.timestamp.toFixed(2)}s:`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: frame.base64 },
    });
  }
  content.push({ type: "text", text: prompt });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.1,
    messages: [{ role: "user", content }],
  });
  return extractText(response);
}
