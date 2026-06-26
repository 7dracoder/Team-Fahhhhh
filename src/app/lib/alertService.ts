import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildRichAlertBody } from "@/app/lib/alertMessageText";
import { ALERTS_DIR } from "@/app/lib/storage";
import { publish } from "@/app/lib/sessionBus";
import type { AnalysisEvent } from "@/app/lib/types";

const DEDUPE_WINDOW_MS = 60_000;
/** Minimum time between any two real alert sends (Photon worker), in ms. */
const GLOBAL_ALERT_MIN_INTERVAL_MS = 5_000;

const globalAny = globalThis as unknown as {
  __alertDedupe?: Map<string, number>;
  __lastGlobalAlertAt?: number;
};

const dedupe: Map<string, number> =
  globalAny.__alertDedupe ?? (globalAny.__alertDedupe = new Map());

function getLastGlobalAlertAt(): number {
  return globalAny.__lastGlobalAlertAt ?? 0;
}

function setLastGlobalAlertAt(t: number): void {
  globalAny.__lastGlobalAlertAt = t;
}

function ttsBody(event: AnalysisEvent): string {
  return `Critical alert. ${event.patientLabel}. ${event.summary}.`;
}

async function sendElevenLabsTts(event: AnalysisEvent): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.warn(
      "[alertService] ElevenLabs env vars missing (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID); skipping TTS",
    );
    return null;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: ttsBody(event),
        model_id: "eleven_turbo_v2_5",
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const filename = `${randomUUID()}.mp3`;
  await fs.mkdir(ALERTS_DIR, { recursive: true });
  await fs.writeFile(path.join(ALERTS_DIR, filename), buf);
  console.log(`[alertService] TTS saved ${filename} (${buf.length} bytes)`);
  return filename;
}

async function sendPhotonWorkerAlert(event: AnalysisEvent): Promise<void> {
  const base = (
    process.env.SPECTRUM_ALERT_WORKER_URL ?? "http://127.0.0.1:39847"
  ).replace(/\/$/, "");
  const secret = process.env.SPECTRUM_ALERT_WORKER_SECRET;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const res = await fetch(`${base}/send-alert`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Photon worker ${res.status}: ${text.slice(0, 300)}`);
  }
  console.log(
    `[alertService] Photon alert dispatched for event ${event.id} (${event.severity})`,
  );
}

export async function sendAlert(event: AnalysisEvent): Promise<void> {
  if (event.severity !== "critical" && event.severity !== "urgent") return;

  const dedupeKey = `${event.patientLabel}:${event.eventType}`;
  const lastSent = dedupe.get(dedupeKey);
  const now = Date.now();
  if (lastSent && now - lastSent < DEDUPE_WINDOW_MS) {
    console.log(
      `[alertService] dedupe (${Math.round((now - lastSent) / 1000)}s ago) skipping ${dedupeKey}`,
    );
    return;
  }

  const lastGlobal = getLastGlobalAlertAt();
  if (
    lastGlobal > 0 &&
    now - lastGlobal < GLOBAL_ALERT_MIN_INTERVAL_MS
  ) {
    console.log(
      `[alertService] global throttle (${GLOBAL_ALERT_MIN_INTERVAL_MS}ms) skipping alert`,
    );
    return;
  }

  dedupe.set(dedupeKey, now);

  // Mock by default to protect API credits. Set MOCK_ALERTS=false to actually
  // hit the Spectrum worker + ElevenLabs (and put credentials in .env.local).
  if (process.env.MOCK_ALERTS !== "false") {
    console.log(
      `[MOCK ALERT][${event.severity.toUpperCase()}]\n${buildRichAlertBody(event)}\n(sms${
        event.severity === "critical" ? " + tts" : ""
      })`,
    );
    return;
  }

  try {
    await sendPhotonWorkerAlert(event);
    setLastGlobalAlertAt(Date.now());
  } catch (err) {
    console.error(
      "[alertService] Photon worker failed:",
      err instanceof Error ? err.message : err,
    );
  }

  if (event.severity === "critical") {
    try {
      const filename = await sendElevenLabsTts(event);
      if (filename && event.sessionId) {
        publish(event.sessionId, { type: "play_alert", data: { audioPath: filename } });
      }
    } catch (err) {
      console.error(
        "[alertService] ElevenLabs TTS failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
