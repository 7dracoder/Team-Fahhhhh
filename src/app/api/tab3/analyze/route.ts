/**
 * @deprecated Tab 3 live analysis now uses the Overshoot browser SDK; frames are
 * not posted here. Kept for manual testing or legacy callers. Prefer POST
 * /api/tab3/ingest with pre-structured JSON from RealtimeVision.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { insert, readTable } from "@/app/lib/storage";
import { publish } from "@/app/lib/sessionBus";
import { sendAlert } from "@/app/lib/alertService";
import { analyzeFrame } from "@/app/lib/anthropic";
import type {
  AnalysisEvent,
  EventType,
  LiveSession,
  Severity,
} from "@/app/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const PROMPT = `You are analyzing a single frame from live CCTV of a medical waiting room. Identify medical concerns for visible people. Use short descriptive labels (2-4 words) like "elderly woman red jacket".

Watch for: choking, bleeding, seizure, cardiac distress, stroke signs, falls, respiratory distress, agitation.

Return ONLY JSON, no preamble, no fences:
{
  "observations": [
    {
      "patientLabel": "...",
      "eventType": "...",
      "severity": "...",
      "summary": "one sentence",
      "symptoms": ["..."],
      "confidence": 0.0
    }
  ]
}

eventType: choking|bleeding|seizure|cardiac|stroke|fall|respiratory|agitation|unresponsive|anaphylaxis|syncope|vomiting|cyanosis|environmental|violence|hypoglycemia|overdose|pain_crisis|other|normal
severity: normal|low|moderate|urgent|critical

Only include severity != "normal". If nothing concerning: {"observations": []}.`;

interface ModelObservation {
  patientLabel?: unknown;
  eventType?: unknown;
  severity?: unknown;
  summary?: unknown;
  symptoms?: unknown;
  confidence?: unknown;
}

interface ParsedObservation {
  patientLabel: string;
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

function coerce(obs: ModelObservation): ParsedObservation | null {
  const patientLabel =
    typeof obs.patientLabel === "string" ? obs.patientLabel.trim() : "";
  const eventTypeRaw =
    typeof obs.eventType === "string" ? obs.eventType.trim() : "";
  const severityRaw =
    typeof obs.severity === "string" ? obs.severity.trim() : "";
  if (!patientLabel || !eventTypeRaw || !severityRaw) return null;
  if (!VALID_EVENT_TYPES.has(eventTypeRaw as EventType)) return null;
  if (!VALID_SEVERITIES.has(severityRaw as Severity)) return null;

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
    patientLabel,
    eventType: eventTypeRaw as EventType,
    severity: severityRaw as Severity,
    summary: summary || `${eventTypeRaw} concern observed`,
    symptoms,
    confidence,
  };
}

interface AnalyzeBody {
  sessionId?: unknown;
  timestamp?: unknown;
  imageBase64?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalyzeBody;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const timestamp =
      typeof body.timestamp === "number" && Number.isFinite(body.timestamp)
        ? body.timestamp
        : NaN;
    const imageBase64 =
      typeof body.imageBase64 === "string"
        ? body.imageBase64.replace(/^data:image\/[a-z]+;base64,/i, "")
        : "";

    if (!sessionId || !Number.isFinite(timestamp) || !imageBase64) {
      return NextResponse.json(
        { error: "sessionId, timestamp, and imageBase64 are required" },
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

    const text = await analyzeFrame(imageBase64, PROMPT);
    const cleaned = stripJsonFences(text);

    let parsed: { observations?: unknown };
    try {
      parsed = JSON.parse(cleaned) as { observations?: unknown };
    } catch (err) {
      console.error(
        "[/api/tab3/analyze] failed to parse model output:",
        err instanceof Error ? err.message : err,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json({ observations: [] });
    }

    const rawObservations = Array.isArray(parsed.observations)
      ? (parsed.observations as ModelObservation[])
      : [];

    const insertedEvents: AnalysisEvent[] = [];
    const createdAt = new Date().toISOString();

    for (const raw of rawObservations) {
      const obs = coerce(raw);
      if (!obs) continue;
      if (obs.severity === "normal") continue;

      const event: AnalysisEvent = {
        id: randomUUID(),
        sessionId,
        startTs: +timestamp.toFixed(2),
        endTs: +(timestamp + 1).toFixed(2),
        eventType: obs.eventType,
        severity: obs.severity,
        patientLabel: obs.patientLabel,
        summary: obs.summary,
        symptoms: obs.symptoms,
        confidence: +obs.confidence.toFixed(3),
        source: "live",
        createdAt,
      };

      await insert<AnalysisEvent>("events", event);
      publish(sessionId, { type: "event", data: event });
      insertedEvents.push(event);

      if (event.severity === "critical" || event.severity === "urgent") {
        sendAlert(event).catch((err) =>
          console.error("[/api/tab3/analyze] alert failed:", err),
        );
      }
    }

    return NextResponse.json({ observations: insertedEvents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/analyze POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
