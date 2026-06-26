import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  STORAGE_ROOT,
  THUMBNAILS_DIR,
  VIDEOS_DIR,
  insert,
} from "@/app/lib/storage";
import { extractThumbnail, getDuration } from "@/app/lib/ffmpeg";
import type {
  AnalysisEvent,
  EventType,
  Severity,
  Upload,
} from "@/app/lib/types";

export const runtime = "nodejs";

const SAMPLES_DIR = path.join(STORAGE_ROOT, "samples");
const DEMO_VIDEO = path.join(SAMPLES_DIR, "demo.mp4");
const DEMO_EVENTS = path.join(SAMPLES_DIR, "demo-events.json");

const VALID_SEVERITIES = new Set<Severity>([
  "normal",
  "low",
  "moderate",
  "urgent",
  "critical",
]);
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

interface RawEvent {
  startTs?: unknown;
  endTs?: unknown;
  eventType?: unknown;
  severity?: unknown;
  patientLabel?: unknown;
  summary?: unknown;
  symptoms?: unknown;
  confidence?: unknown;
  source?: unknown;
}

function coerce(raw: RawEvent): Omit<AnalysisEvent, "id" | "uploadId" | "createdAt"> | null {
  const startTs = typeof raw.startTs === "number" && Number.isFinite(raw.startTs) ? raw.startTs : null;
  const endTs = typeof raw.endTs === "number" && Number.isFinite(raw.endTs) ? raw.endTs : null;
  const eventTypeRaw = typeof raw.eventType === "string" ? raw.eventType.trim() : "";
  const severityRaw = typeof raw.severity === "string" ? raw.severity.trim() : "";
  const patientLabel = typeof raw.patientLabel === "string" ? raw.patientLabel.trim() : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";

  if (startTs === null || endTs === null) return null;
  if (!VALID_EVENT_TYPES.has(eventTypeRaw as EventType)) return null;
  if (!VALID_SEVERITIES.has(severityRaw as Severity)) return null;
  if (!patientLabel || !summary) return null;

  const symptoms = Array.isArray(raw.symptoms)
    ? raw.symptoms.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.7;
  const source: "upload" | "live" =
    raw.source === "live" ? "live" : "upload";

  return {
    startTs,
    endTs,
    eventType: eventTypeRaw as EventType,
    severity: severityRaw as Severity,
    patientLabel,
    summary,
    symptoms,
    confidence,
    source,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST() {
  try {
    if (!(await fileExists(DEMO_VIDEO))) {
      return NextResponse.json(
        {
          error:
            "demo.mp4 not found. Place demo.mp4 and demo-events.json in ./storage/samples/ (see storage/samples/README.md).",
        },
        { status: 404 },
      );
    }
    if (!(await fileExists(DEMO_EVENTS))) {
      return NextResponse.json(
        {
          error:
            "demo-events.json not found. Place it in ./storage/samples/ (see storage/samples/README.md).",
        },
        { status: 404 },
      );
    }

    const raw = await fs.readFile(DEMO_EVENTS, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Failed to parse demo-events.json: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      );
    }
    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "demo-events.json must be a JSON array of event objects" },
        { status: 400 },
      );
    }

    const id = randomUUID();
    const storagePath = path.join(VIDEOS_DIR, `${id}.mp4`);
    await fs.copyFile(DEMO_VIDEO, storagePath);

    let durationSeconds: number | undefined;
    try {
      durationSeconds = await getDuration(storagePath);
    } catch (err) {
      console.warn(
        "[demo/seed] ffprobe failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }

    let thumbnailPath: string | undefined;
    try {
      const thumb = path.join(THUMBNAILS_DIR, `${id}.jpg`);
      await extractThumbnail(storagePath, thumb, 1);
      thumbnailPath = thumb;
    } catch (err) {
      console.warn(
        "[demo/seed] thumbnail extraction failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }

    const createdAt = new Date().toISOString();
    const upload: Upload = {
      id,
      filename: "demo.mp4",
      storagePath,
      durationSeconds,
      thumbnailPath,
      status: "done",
      createdAt,
    };
    await insert<Upload>("uploads", upload);

    let inserted = 0;
    let skipped = 0;
    for (const item of parsed as RawEvent[]) {
      const fields = coerce(item ?? {});
      if (!fields) {
        skipped += 1;
        continue;
      }
      const event: AnalysisEvent = {
        ...fields,
        id: randomUUID(),
        uploadId: id,
        createdAt,
      };
      await insert<AnalysisEvent>("events", event);
      inserted += 1;
    }

    return NextResponse.json({
      uploadId: id,
      eventsInserted: inserted,
      eventsSkipped: skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/demo/seed POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
