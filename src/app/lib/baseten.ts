/**
 * Baseten client — two dedicated, OpenAI-compatible deployments.
 *
 *   Text (GPT OSS 120B)  → nurse replies + shift-handoff summary
 *   Vision (Gemma 3 27B) → Tab 1 / Tab 2 frame triage
 *
 * Both expose the OpenAI /chat/completions schema, so we POST with plain fetch
 * and avoid adding the openai dependency.
 *
 * Required env:
 *   BASETEN_API_KEY_GPT     — key for the GPT OSS deployment
 *   BASETEN_GPT_URL         — base URL of the GPT OSS deployment (…/v1)
 *   BASETEN_API_KEY_GEMMA   — key for the Gemma vision deployment
 *   BASETEN_GEMMA_URL       — base URL of the Gemma deployment (…/v1)
 * Optional env:
 *   BASETEN_GPT_MODEL       — model slug sent in the request (default below)
 *   BASETEN_GEMMA_MODEL     — model slug sent in the request (default below)
 */

const DEFAULT_GPT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GEMMA_MODEL = "gemma";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Hard cap on output tokens. Keep low for latency-sensitive calls. */
  maxTokens?: number;
  temperature?: number;
  /** Abort the request after this many ms (default 45000) so callers can fall back. */
  timeoutMs?: number;
}

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function normalize(url: string): string {
  return url.replace(/\/$/, "");
}

function getTextEndpoint(): Endpoint | null {
  const apiKey = process.env.BASETEN_API_KEY_GPT?.trim();
  const baseUrl = process.env.BASETEN_GPT_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  return {
    apiKey,
    baseUrl: normalize(baseUrl),
    model: process.env.BASETEN_GPT_MODEL?.trim() || DEFAULT_GPT_MODEL,
  };
}

function getVisionEndpoint(): Endpoint | null {
  const apiKey = process.env.BASETEN_API_KEY_GEMMA?.trim();
  const baseUrl = process.env.BASETEN_GEMMA_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  return {
    apiKey,
    baseUrl: normalize(baseUrl),
    model: process.env.BASETEN_GEMMA_MODEL?.trim() || DEFAULT_GEMMA_MODEL,
  };
}

export function isBasetenTextConfigured(): boolean {
  return getTextEndpoint() !== null;
}

export function isBasetenVisionConfigured(): boolean {
  return getVisionEndpoint() !== null;
}

type OpenAIContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: OpenAIContent;
}

async function postChat(
  endpoint: Endpoint,
  messages: OpenAIMessage[],
  opts: ChatOptions,
): Promise<string> {
  // Fail fast if the deployment is cold/unreachable so callers can fall back
  // instead of hanging until the route's maxDuration.
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Baseten request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Baseten ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Baseten returned empty content");
  }
  // Gemma can append chat control tokens; strip them so downstream
  // JSON.parse / text handling stays clean.
  return content
    .replace(/<end_of_turn>/g, "")
    .replace(/<eos>/g, "")
    .trim();
}

/**
 * Text chat completion against the GPT OSS deployment.
 * Throws on transport / non-2xx / empty-content so callers can fall back.
 */
export async function basetenChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const endpoint = getTextEndpoint();
  if (!endpoint) throw new Error("Baseten text endpoint is not configured");
  return postChat(endpoint, messages, opts);
}

/**
 * Vision analysis against the Gemma deployment: one image + a prompt, returns
 * the model's text (expected to be JSON per the caller's prompt).
 * Throws on transport / non-2xx / empty-content so callers can fall back.
 */
export async function basetenVisionAnalyze(
  imageBase64: string,
  prompt: string,
  opts: ChatOptions & { systemPrompt?: string } = {},
): Promise<string> {
  const endpoint = getVisionEndpoint();
  if (!endpoint) throw new Error("Baseten vision endpoint is not configured");

  const messages: OpenAIMessage[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
      },
      { type: "text", text: prompt },
    ],
  });

  return postChat(endpoint, messages, opts);
}

/**
 * Multi-image vision analysis (Tab 2 batch). Frames are interleaved with their
 * timestamp labels, followed by the prompt.
 */
export async function basetenVisionAnalyzeBatch(
  frames: Array<{ base64: string; timestamp: number }>,
  prompt: string,
  opts: ChatOptions & { systemPrompt?: string } = {},
): Promise<string> {
  const endpoint = getVisionEndpoint();
  if (!endpoint) throw new Error("Baseten vision endpoint is not configured");
  if (frames.length === 0) {
    throw new Error("basetenVisionAnalyzeBatch requires at least one frame");
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  for (const frame of frames) {
    content.push({ type: "text", text: `Frame at t=${frame.timestamp.toFixed(2)}s:` });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
    });
  }
  content.push({ type: "text", text: prompt });

  const messages: OpenAIMessage[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content });

  return postChat(endpoint, messages, opts);
}
