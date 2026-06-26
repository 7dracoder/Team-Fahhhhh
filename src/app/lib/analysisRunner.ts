import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { STORAGE_ROOT, insert, readTable, update } from "@/app/lib/storage";
import { extractFrames, getDuration } from "@/app/lib/ffmpeg";
import { analyzeFrameBatch } from "@/app/lib/anthropic";
import type { AnalysisEvent, EventType, Severity, Upload } from "@/app/lib/types";

export interface ProgressEntry {
  percent: number;
  message: string;
}

const globalAny = globalThis as unknown as {
  __analysisProgress?: Map<string, ProgressEntry>;
  __analysisRunning?: Set<string>;
};

const progressMap: Map<string, ProgressEntry> =
  globalAny.__analysisProgress ?? (globalAny.__analysisProgress = new Map());

const running: Set<string> = globalAny.__analysisRunning ?? (globalAny.__analysisRunning = new Set());

export function getProgress(uploadId: string): ProgressEntry {
  return progressMap.get(uploadId) ?? { percent: 0, message: "" };
}

function setProgress(uploadId: string, percent: number, message: string): void {
  progressMap.set(uploadId, { percent, message });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface StubEventSpec {
  patientLabel: string;
  eventType: EventType;
  severity: Severity;
  summary: string;
  symptoms: string[];
  confidence: number;
}

const STUB_EVENT_SPECS: StubEventSpec[] = [
  {
    patientLabel: "Patient 1",
    eventType: "normal",
    severity: "normal",
    summary: "Resting calmly in waiting-room chair, alert and oriented.",
    symptoms: ["calm", "alert"],
    confidence: 0.62,
  },
  {
    patientLabel: "Patient 2",
    eventType: "normal",
    severity: "normal",
    summary: "Reading magazine; vitals appear stable, no visible distress.",
    symptoms: ["alert", "stable posture"],
    confidence: 0.6,
  },
  {
    patientLabel: "Patient 1",
    eventType: "agitation",
    severity: "low",
    summary: "Mild restlessness; shifting position frequently and rubbing temple.",
    symptoms: ["fidgeting", "shifting posture", "headache cue"],
    confidence: 0.71,
  },
  {
    patientLabel: "Patient 2",
    eventType: "respiratory",
    severity: "moderate",
    summary: "Increased breathing rate and leaning forward; possible respiratory distress.",
    symptoms: ["tachypnea", "tripod posture"],
    confidence: 0.78,
  },
  {
    patientLabel: "Patient 1",
    eventType: "fall",
    severity: "urgent",
    summary: "Slipped from chair to floor; conscious but unable to rise without assistance.",
    symptoms: ["fall", "ground level", "unable to stand"],
    confidence: 0.86,
  },
  {
    patientLabel: "Patient 2",
    eventType: "cardiac",
    severity: "critical",
    summary: "Clutching chest with pallor and sweating; slumped against wall.",
    symptoms: ["chest pain", "pallor", "diaphoresis", "slumped posture"],
    confidence: 0.93,
  },
];

async function runStub(uploadId: string, durationSeconds: number): Promise<void> {
  const steps: Array<[number, string]> = [
    [25, "Extracting frames"],
    [50, "Sending to model"],
    [75, "Parsing detections"],
    [100, "Saving events"],
  ];
  for (const [percent, message] of steps) {
    setProgress(uploadId, percent, message);
    await sleep(1000);
  }

  const slice = durationSeconds / STUB_EVENT_SPECS.length;
  const window = Math.min(4, Math.max(1, slice));
  const createdAt = new Date().toISOString();

  for (let i = 0; i < STUB_EVENT_SPECS.length; i++) {
    const spec = STUB_EVENT_SPECS[i];
    const startTs = +(i * slice).toFixed(2);
    const endTs = +Math.min(durationSeconds, startTs + window).toFixed(2);
    const event: AnalysisEvent = {
      id: randomUUID(),
      uploadId,
      startTs,
      endTs,
      eventType: spec.eventType,
      severity: spec.severity,
      patientLabel: spec.patientLabel,
      summary: spec.summary,
      symptoms: spec.symptoms,
      confidence: spec.confidence,
      source: "upload",
      createdAt,
    };
    await insert<AnalysisEvent>("events", event);
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  normal: 0,
  low: 1,
  moderate: 2,
  urgent: 3,
  critical: 4,
};

const VALID_SEVERITIES = new Set<Severity>(["normal", "low", "moderate", "urgent", "critical"]);
const VALID_EVENT_TYPES = new Set<EventType>([
  "choking",
  "bleeding",
  "seizure",
  "cardiac",
  "stroke",
  "fall",
  "respiratory",
  "agitation",
  "unresponsive",
  "anaphylaxis",
  "syncope",
  "vomiting",
  "cyanosis",
  "environmental",
  "violence",
  "hypoglycemia",
  "overdose",
  "pain_crisis",
  "other",
  "normal",
]);

const FRAMES_PER_BATCH = 8;
const MERGE_GAP_SECONDS = 3;
const INTER_BATCH_DELAY_MS = 13_000;
const RATE_LIMIT_MAX_RETRIES = 4;

interface ParsedObservation {
  timestamp: number;
  patientLabel: string;
  eventType: EventType;
  severity: Severity;
  summary: string;
  symptoms: string[];
  confidence: number;
}

interface ModelObservation {
  patientLabel?: unknown;
  eventType?: unknown;
  severity?: unknown;
  summary?: unknown;
  symptoms?: unknown;
  confidence?: unknown;
}

interface ModelFrame {
  timestamp?: unknown;
  observations?: unknown;
}

interface ModelResponse {
  frames?: unknown;
}

function buildBatchPrompt(frameCount: number, startSec: number): string {
  return `You are analyzing CCTV footage of a medical waiting room. I'm sending you ${frameCount} consecutive frames, each 1 second apart. The first frame is at timestamp ${startSec} seconds in the video.

For each frame, identify medical concerns for visible people. Use short descriptive patient labels (2-4 words) like "elderly woman red jacket" or "young man grey hoodie" — match the style of Tab 1's analyzer. Be consistent across frames: if the same person appears in multiple frames, use the same label.

Watch for: choking, bleeding, seizure, cardiac distress, stroke signs, falls, respiratory distress, agitation. Be conservative — only flag real concerns, not normal waiting-room behavior.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "frames": [
    {
      "timestamp": 0,
      "observations": [
        {
          "patientLabel": "elderly woman red jacket",
          "eventType": "respiratory",
          "severity": "urgent",
          "summary": "one-sentence description",
          "symptoms": ["rapid shallow breathing", "hand on chest"],
          "confidence": 0.82
        }
      ]
    }
  ]
}

eventType must be one of: choking, bleeding, seizure, cardiac, stroke, fall, respiratory, agitation, unresponsive, anaphylaxis, syncope, vomiting, cyanosis, environmental, violence, hypoglycemia, overdose, pain_crisis, other, normal.
severity must be one of: normal, low, moderate, urgent, critical.

Only include observations where severity != "normal". For frames with nothing concerning, return observations: [].`;
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/m, "")
    .trim();
}

function coerceObservation(obs: ModelObservation, fallbackTs: number): ParsedObservation | null {
  const patientLabel = typeof obs.patientLabel === "string" ? obs.patientLabel.trim() : "";
  const eventTypeRaw = typeof obs.eventType === "string" ? obs.eventType.trim() : "";
  const severityRaw = typeof obs.severity === "string" ? obs.severity.trim() : "";
  if (!patientLabel || !eventTypeRaw || !severityRaw) return null;
  if (!VALID_EVENT_TYPES.has(eventTypeRaw as EventType)) return null;
  if (!VALID_SEVERITIES.has(severityRaw as Severity)) return null;

  const summary = typeof obs.summary === "string" ? obs.summary.trim() : "";
  const symptoms = Array.isArray(obs.symptoms)
    ? obs.symptoms.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const confidence =
    typeof obs.confidence === "number" && Number.isFinite(obs.confidence)
      ? Math.max(0, Math.min(1, obs.confidence))
      : 0.5;

  return {
    timestamp: fallbackTs,
    patientLabel,
    eventType: eventTypeRaw as EventType,
    severity: severityRaw as Severity,
    summary: summary || `${eventTypeRaw} concern observed`,
    symptoms,
    confidence,
  };
}

function shortError(err: unknown): string {
  if (!err) return "unknown error";
  const e = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
  if (e.status === 429) {
    const inner = e.error?.error?.message;
    return inner ? `429 rate limit: ${inner.slice(0, 120)}…` : "429 rate limit";
  }
  if (typeof e.status === "number") return `${e.status} ${e.message ?? ""}`.trim();
  return e.message ?? String(err);
}

function getRetryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string> })?.headers;
  const raw = headers?.["retry-after"];
  if (!raw) return null;
  const seconds = parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(120_000, seconds * 1000 + 500);
}

async function callBatchWithRetry(
  frameInputs: { base64: string; timestamp: number }[],
  prompt: string,
  onWaiting: (waitMs: number, attempt: number) => void,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await analyzeFrameBatch(frameInputs, prompt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429 || attempt === RATE_LIMIT_MAX_RETRIES) throw err;
      const waitMs = getRetryAfterMs(err) ?? Math.min(60_000, 2 ** attempt * 5_000);
      onWaiting(waitMs, attempt);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function parseBatchResponse(text: string, batchStartSec: number): ParsedObservation[] {
  const cleaned = stripJsonFences(text);
  const parsed = JSON.parse(cleaned) as ModelResponse;
  const out: ParsedObservation[] = [];
  if (!Array.isArray(parsed.frames)) return out;

  for (const frameRaw of parsed.frames as ModelFrame[]) {
    if (!frameRaw || typeof frameRaw !== "object") continue;
    const ts =
      typeof frameRaw.timestamp === "number" && Number.isFinite(frameRaw.timestamp)
        ? frameRaw.timestamp
        : batchStartSec;
    const observations = Array.isArray(frameRaw.observations) ? frameRaw.observations : [];
    for (const obsRaw of observations as ModelObservation[]) {
      const obs = coerceObservation(obsRaw, ts);
      if (!obs) continue;
      if (obs.severity === "normal") continue;
      out.push(obs);
    }
  }
  return out;
}

interface MergedEvent {
  patientLabel: string;
  eventType: EventType;
  severity: Severity;
  summary: string;
  symptoms: string[];
  confidence: number;
  startTs: number;
  endTs: number;
}

function mergeObservations(
  observations: ParsedObservation[],
  durationSeconds: number,
): MergedEvent[] {
  const groups = new Map<string, ParsedObservation[]>();
  for (const obs of observations) {
    const key = `${obs.patientLabel}\u0000${obs.eventType}`;
    const arr = groups.get(key);
    if (arr) arr.push(obs);
    else groups.set(key, [obs]);
  }

  const merged: MergedEvent[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.timestamp - b.timestamp);
    let cluster: ParsedObservation[] = [];

    const flush = () => {
      if (cluster.length === 0) return;
      const startTs = cluster[0].timestamp;
      const lastTs = cluster[cluster.length - 1].timestamp;
      const endTs = Math.min(durationSeconds, lastTs + 1);
      const top = cluster.reduce((acc, o) =>
        SEVERITY_RANK[o.severity] > SEVERITY_RANK[acc.severity] ? o : acc,
      );
      const symptoms = Array.from(new Set(cluster.flatMap((o) => o.symptoms)));
      const confidence =
        cluster.reduce((sum, o) => sum + o.confidence, 0) / cluster.length;
      merged.push({
        patientLabel: cluster[0].patientLabel,
        eventType: cluster[0].eventType,
        severity: top.severity,
        summary: top.summary,
        symptoms,
        confidence,
        startTs,
        endTs,
      });
      cluster = [];
    };

    for (const obs of arr) {
      if (cluster.length === 0) {
        cluster.push(obs);
        continue;
      }
      const lastTs = cluster[cluster.length - 1].timestamp;
      if (obs.timestamp - lastTs <= MERGE_GAP_SECONDS) {
        cluster.push(obs);
      } else {
        flush();
        cluster.push(obs);
      }
    }
    flush();
  }

  merged.sort((a, b) => a.startTs - b.startTs);
  return merged;
}

async function realAnalysis(uploadId: string): Promise<void> {
  let uploads = await readTable<Upload>("uploads");
  let upload = uploads.find((u) => u.id === uploadId);
  if (!upload) throw new Error(`Upload ${uploadId} not found`);

  if (!upload.durationSeconds || upload.durationSeconds <= 0) {
    setProgress(uploadId, 2, "Probing duration");
    const duration = await getDuration(upload.storagePath);
    upload = await update<Upload>("uploads", uploadId, { durationSeconds: duration });
  }
  const duration = upload.durationSeconds!;

  const tmpDir = path.join(STORAGE_ROOT, "tmp", `frames-${uploadId}`);

  try {
    setProgress(uploadId, 5, "Extracting frames");
    const frames = await extractFrames(upload.storagePath, tmpDir, 1);
    if (frames.length === 0) throw new Error("ffmpeg produced 0 frames");
    setProgress(uploadId, 10, `Extracted ${frames.length} frames`);

    const batches: string[][] = [];
    for (let i = 0; i < frames.length; i += FRAMES_PER_BATCH) {
      batches.push(frames.slice(i, i + FRAMES_PER_BATCH));
    }

    const observations: ParsedObservation[] = [];
    let succeededBatches = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const batchStartSec = bi * FRAMES_PER_BATCH;

      if (bi > 0) await sleep(INTER_BATCH_DELAY_MS);

      try {
        const frameInputs = await Promise.all(
          batch.map(async (filePath, i) => ({
            base64: (await fs.readFile(filePath)).toString("base64"),
            timestamp: batchStartSec + i,
          })),
        );
        const prompt = buildBatchPrompt(batch.length, batchStartSec);
        const text = await callBatchWithRetry(frameInputs, prompt, (waitMs, attempt) => {
          setProgress(
            uploadId,
            Math.min(95, Math.round(10 + (bi / batches.length) * 85)),
            `Batch ${bi + 1}/${batches.length}: rate limited, retry ${attempt} in ${Math.round(waitMs / 1000)}s`,
          );
        });
        const obs = parseBatchResponse(text, batchStartSec);
        observations.push(...obs);
        succeededBatches += 1;
      } catch (err) {
        console.error(`[realAnalysis] batch ${bi + 1}/${batches.length} failed:`, shortError(err));
      }

      const pct = Math.min(95, Math.round(10 + ((bi + 1) / batches.length) * 85));
      setProgress(uploadId, pct, `Analyzed batch ${bi + 1}/${batches.length}`);
    }

    if (succeededBatches === 0) {
      throw new Error(`All ${batches.length} batch(es) failed`);
    }

    const merged = mergeObservations(observations, duration);
    setProgress(uploadId, 97, `Saving ${merged.length} event${merged.length === 1 ? "" : "s"}`);

    const createdAt = new Date().toISOString();
    for (const m of merged) {
      const event: AnalysisEvent = {
        id: randomUUID(),
        uploadId,
        startTs: +m.startTs.toFixed(2),
        endTs: +m.endTs.toFixed(2),
        eventType: m.eventType,
        severity: m.severity,
        patientLabel: m.patientLabel,
        summary: m.summary,
        symptoms: m.symptoms,
        confidence: +m.confidence.toFixed(3),
        source: "upload",
        createdAt,
      };
      await insert<AnalysisEvent>("events", event);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      console.warn(`[realAnalysis] failed to remove ${tmpDir}:`, err);
    });
  }
}

async function runAnalysis(uploadId: string): Promise<void> {
  setProgress(uploadId, 0, "Starting");
  await update<Upload>("uploads", uploadId, { status: "analyzing" });

  try {
    const uploads = await readTable<Upload>("uploads");
    const upload = uploads.find((u) => u.id === uploadId);
    if (!upload) throw new Error(`Upload ${uploadId} not found`);

    const duration = upload.durationSeconds ?? 60;

    if (process.env.USE_STUB_WORKER === "true") {
      await runStub(uploadId, duration);
    } else {
      await realAnalysis(uploadId);
    }

    setProgress(uploadId, 100, "Complete");
    await update<Upload>("uploads", uploadId, { status: "done", error: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analysisRunner] ${uploadId} failed:`, message);
    setProgress(uploadId, 100, `Failed: ${message}`);
    try {
      await update<Upload>("uploads", uploadId, { status: "failed", error: message });
    } catch (writeErr) {
      console.error(`[analysisRunner] failed to mark upload as failed:`, writeErr);
    }
  } finally {
    running.delete(uploadId);
  }
}

export async function startAnalysis(uploadId: string): Promise<void> {
  if (running.has(uploadId)) return;
  running.add(uploadId);
  setProgress(uploadId, 0, "Queued");
  void runAnalysis(uploadId);
}
