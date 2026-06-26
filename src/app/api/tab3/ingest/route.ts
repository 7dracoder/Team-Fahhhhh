import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { insert, readTable } from "@/app/lib/storage";
import { publish } from "@/app/lib/sessionBus";
import { sendAlert } from "@/app/lib/alertService";
import type {
  AnalysisEvent,
  EventType,
  LiveSession,
  Severity,
} from "@/app/lib/types";

export const runtime = "nodejs";

const INGEST_SEVERITIES = new Set<Severity>([
  "normal",
  "low",
  "moderate",
  "urgent",
  "critical",
]);

const VALID_EVENT_TYPES = new Set<EventType>([
  "normal",
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
]);

interface ModelObservation {
  eventType?: unknown;
  severity?: unknown;
  summary?: unknown;
  symptoms?: unknown;
  confidence?: unknown;
}

interface CoercedObservation {
  eventType: EventType;
  severity: Severity;
  summary: string;
  symptoms: string[];
  confidence: number;
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/m, "")
    .trim();
}

function coerceObservation(obs: ModelObservation): CoercedObservation | null {
  const eventTypeRaw =
    typeof obs.eventType === "string" ? obs.eventType.trim() : "";
  const severityRaw =
    typeof obs.severity === "string" ? obs.severity.trim() : "";
  if (!eventTypeRaw || !severityRaw) return null;
  if (!VALID_EVENT_TYPES.has(eventTypeRaw as EventType)) return null;
  if (!INGEST_SEVERITIES.has(severityRaw as Severity)) return null;

  const summary = typeof obs.summary === "string" ? obs.summary.trim() : "";
  const symptoms = Array.isArray(obs.symptoms)
    ? obs.symptoms.filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : [];
  const confidence =
    typeof obs.confidence === "number" && Number.isFinite(obs.confidence)
      ? Math.max(0, Math.min(1, obs.confidence))
      : 0.5;

  return {
    eventType: eventTypeRaw as EventType,
    severity: severityRaw as Severity,
    summary: summary || `${eventTypeRaw} concern observed`,
    symptoms,
    confidence,
  };
}

function sessionPatientLabel(session: LiveSession): string {
  const raw = session.patientLabel?.trim();
  return raw && raw.length > 0 ? raw : "Patient";
}

interface IngestBody {
  sessionId?: unknown;
  timestamp?: unknown;
  result?: unknown;
  finishReason?: unknown;
  totalLatencyMs?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IngestBody;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const timestamp =
      typeof body.timestamp === "number" && Number.isFinite(body.timestamp)
        ? body.timestamp
        : NaN;
    const resultRaw =
      typeof body.result === "string" ? body.result : "";

    if (!sessionId || !Number.isFinite(timestamp) || !resultRaw) {
      return NextResponse.json(
        { error: "sessionId, timestamp, and result are required" },
        { status: 400 },
      );
    }

    const sessions = await readTable<LiveSession>("sessions");
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 400 });
    }
    if (session.status !== "active") {
      return NextResponse.json(
        { error: "Session is not active" },
        { status: 400 },
      );
    }

    const cleaned = stripJsonFences(resultRaw);

    let parsed: { observation?: unknown };
    try {
      parsed = JSON.parse(cleaned) as { observation?: unknown };
    } catch (err) {
      console.warn(
        "[/api/tab3/ingest] parse_error:",
        err instanceof Error ? err.message : err,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json({ ok: false, error: "parse_error" });
    }

    if (!("observation" in parsed)) {
      return NextResponse.json({ ok: false, error: "parse_error" });
    }

    if (parsed.observation === null || parsed.observation === "stable") {
      return NextResponse.json({ ok: true, eventsCreated: 0 });
    }

    if (typeof parsed.observation !== "object" || parsed.observation === null) {
      return NextResponse.json({ ok: false, error: "parse_error" });
    }

    const obs = coerceObservation(parsed.observation as ModelObservation);
    if (!obs) {
      return NextResponse.json({ ok: false, error: "parse_error" });
    }

    if (obs.severity === "normal" || obs.eventType === "normal") {
      return NextResponse.json({ ok: true, eventsCreated: 0 });
    }

    const patientLabel = sessionPatientLabel(session);
    const createdAt = new Date().toISOString();

    const event: AnalysisEvent = {
      id: randomUUID(),
      sessionId,
      startTs: +timestamp.toFixed(2),
      endTs: +(timestamp + 1).toFixed(2),
      eventType: obs.eventType,
      severity: obs.severity,
      patientLabel,
      summary: obs.summary,
      symptoms: obs.symptoms,
      confidence: +obs.confidence.toFixed(3),
      source: "live",
      createdAt,
    };

    await insert<AnalysisEvent>("events", event);
    publish(sessionId, { type: "event", data: event });

    if (event.severity === "critical" || event.severity === "urgent") {
      sendAlert(event).catch((err) =>
        console.error("[/api/tab3/ingest] alert failed:", err),
      );
    }

    return NextResponse.json({ ok: true, eventsCreated: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/ingest POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
