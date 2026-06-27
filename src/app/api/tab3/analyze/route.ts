/**
 * Tab 3 live frame analysis (Baseten Gemma vision, Claude fallback).
 *
 * The browser captures a frame every few seconds and POSTs it here. We classify
 * a single patient, ALWAYS return the observation (so the UI status panel updates
 * even for "normal"), and only persist / stream / alert when something concerning
 * is detected.
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

const PROMPT = `You are continuously monitoring a SINGLE patient on a live camera feed. Describe what is happening right now and classify any medical concern.

Assume there is ONE patient in view. If several people are visible, focus on the person who appears to be the patient (seated, lying, or central — not staff or passersby). Ignore bystanders.

Return ONLY JSON, no preamble, no markdown fences:
{"observation":{"patientLabel":"...","eventType":"...","severity":"...","summary":"one factual sentence","symptoms":["..."],"confidence":0.0}}

patientLabel: short 2-4 word physical descriptor (e.g. "elderly woman blue gown"). If unsure, use "patient".
eventType: normal|choking|bleeding|seizure|cardiac|stroke|fall|respiratory|agitation|unresponsive|anaphylaxis|syncope|vomiting|cyanosis|environmental|violence|hypoglycemia|overdose|pain_crisis|other
severity: normal|low|moderate|urgent|critical

Guidance:
- normal: routine, resting, ordinary activity. Use eventType "normal" AND severity "normal". Still write an accurate summary and symptoms (e.g. "Patient seated upright, eyes open").
- critical: life threat now (unresponsive + not breathing, active seizure, severe bleeding, cardiac collapse).
- urgent: serious and deteriorating (stroke signs, choking, significant bleeding, chest pain with distress).
- moderate: concerning but stable (labored breathing, visible pain, conscious fall).
- low: mild concern (agitation, restlessness, mild discomfort).

confidence: 0.0-1.0; lower when the view is partial, occluded, or ambiguous.
If the patient is not visible: eventType "normal", severity "normal", summary saying not visible, low confidence. Never invent a crisis.`;

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
  const eventTypeRaw =
    typeof obs.eventType === "string" ? obs.eventType.trim() : "";
  const severityRaw =
    typeof obs.severity === "string" ? obs.severity.trim() : "";
  if (!eventTypeRaw || !severityRaw) return null;
  if (!VALID_EVENT_TYPES.has(eventTypeRaw as EventType)) return null;
  if (!VALID_SEVERITIES.has(severityRaw as Severity)) return null;

  const patientLabel =
    typeof obs.patientLabel === "string" && obs.patientLabel.trim().length > 0
      ? obs.patientLabel.trim()
      : "patient";
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
    summary: summary || `${eventTypeRaw} observed`,
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
      return NextResponse.json({ error: "Session is not active" }, { status: 400 });
    }

    const text = await analyzeFrame(imageBase64, PROMPT);
    const cleaned = stripJsonFences(text);

    let parsed: { observation?: unknown };
    try {
      parsed = JSON.parse(cleaned) as { observation?: unknown };
    } catch (err) {
      console.error(
        "[/api/tab3/analyze] failed to parse model output:",
        err instanceof Error ? err.message : err,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json({ observation: null });
    }

    const obs = coerce(parsed.observation as ModelObservation);
    if (!obs) {
      return NextResponse.json({ observation: null });
    }

    // Always return the observation so the UI can show live "current status".
    const observationResponse = {
      patientLabel: obs.patientLabel,
      eventType: obs.eventType,
      severity: obs.severity,
      summary: obs.summary,
      symptoms: obs.symptoms,
      confidence: +obs.confidence.toFixed(3),
    };

    // Only persist / stream / alert on a real concern.
    if (obs.severity === "normal" || obs.eventType === "normal") {
      return NextResponse.json({ observation: observationResponse, event: null });
    }

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
      createdAt: new Date().toISOString(),
    };

    await insert<AnalysisEvent>("events", event);
    publish(sessionId, { type: "event", data: event });

    if (event.severity === "critical" || event.severity === "urgent") {
      sendAlert(event).catch((err) =>
        console.error("[/api/tab3/analyze] alert failed:", err),
      );
    }

    return NextResponse.json({ observation: observationResponse, event });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/analyze POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
