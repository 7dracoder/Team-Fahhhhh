import { basetenChat, isBasetenTextConfigured } from "@/app/lib/baseten";
import { getAnthropic } from "@/app/lib/anthropic";
import type { AnalysisEvent, Severity } from "@/app/lib/types";

const FALLBACK_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = [
  "You are a healthcare quality and safety analyst preparing a WEEKLY INCIDENT REPORT for a hospital quality professional (e.g. a Quality & Safety Officer).",
  "The input is JSON: a reporting window plus aggregate statistics and a list of detected incidents from automated patient monitoring (each with day, severity, type, summary, patient label, source, confidence).",
  "Audience: quality/risk management, NOT bedside clinicians. Focus on patterns, trends, and process improvement — not individual bedside care.",
  "Produce a professional report in plain text using exactly these sections with these headers:",
  "EXECUTIVE SUMMARY — 2-3 sentences: total incidents, the most significant patterns, and overall risk posture for the week.",
  "INCIDENT VOLUME — total incidents, breakdown by severity (critical/urgent/moderate/low), and how many sessions/cameras contributed.",
  "TOP INCIDENT TYPES — ranked list of the most frequent event types with counts and a one-line interpretation each.",
  "NOTABLE EVENTS — up to 5 of the highest-severity incidents: [day] severity — type — brief description.",
  "TRENDS & PATTERNS — observations about timing, recurrence, clustering, or anything that stands out across the week.",
  "QUALITY RECOMMENDATIONS — 3-5 concrete, actionable process/safety recommendations a quality team could act on.",
  "Ground every number strictly in the provided data; do not invent statistics. This is an operational quality artifact, not a clinical diagnosis.",
  "Output plain text only. No markdown headers (#), no preamble, no closing remarks.",
].join(" ");

export interface WeeklyReportStats {
  windowStart: string;
  windowEnd: string;
  totalIncidents: number;
  bySeverity: Record<string, number>;
  byEventType: Record<string, number>;
  sessionCount: number;
  bySource: Record<string, number>;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  urgent: 1,
  moderate: 2,
  low: 3,
  normal: 4,
};

/**
 * Compute aggregate stats for a set of incident events within a window.
 * Pure function — no model call — so the UI can show numbers even if the
 * narrative generation fails.
 */
export function computeWeeklyStats(
  events: AnalysisEvent[],
  windowStart: string,
  windowEnd: string,
): WeeklyReportStats {
  const bySeverity: Record<string, number> = {};
  const byEventType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const sessions = new Set<string>();

  for (const e of events) {
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    byEventType[e.eventType] = (byEventType[e.eventType] ?? 0) + 1;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    if (e.sessionId) sessions.add(e.sessionId);
    else if (e.uploadId) sessions.add(e.uploadId);
  }

  return {
    windowStart,
    windowEnd,
    totalIncidents: events.length,
    bySeverity,
    byEventType,
    sessionCount: sessions.size,
    bySource,
  };
}

function buildContext(
  stats: WeeklyReportStats,
  events: AnalysisEvent[],
): string {
  // Cap incident detail to the most severe to stay within context limits.
  const ranked = [...events].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const detailed = ranked.slice(0, 60).map((e) => ({
    day: dayLabel(e.createdAt),
    severity: e.severity,
    eventType: e.eventType,
    patientLabel: e.patientLabel,
    summary: e.summary,
    source: e.source,
    confidence: e.confidence,
  }));

  return JSON.stringify({
    reportingWindow: { start: stats.windowStart, end: stats.windowEnd },
    statistics: {
      totalIncidents: stats.totalIncidents,
      bySeverity: stats.bySeverity,
      byEventType: stats.byEventType,
      bySource: stats.bySource,
      sessionsContributing: stats.sessionCount,
    },
    incidents: detailed,
  });
}

/**
 * Generate a weekly quality/incident report narrative for a quality professional.
 *
 * Primary path: GPT OSS 120B via Baseten. Falls back to Claude when Baseten is
 * unconfigured or errors.
 */
export async function generateWeeklyReport(
  stats: WeeklyReportStats,
  events: AnalysisEvent[],
): Promise<string> {
  if (events.length === 0) {
    return [
      "EXECUTIVE SUMMARY",
      "No incidents were recorded in the selected reporting window. Monitoring coverage produced no critical, urgent, moderate, or low-severity events.",
      "",
      "QUALITY RECOMMENDATIONS",
      "- Confirm monitoring was active across the expected period; zero incidents can indicate either a quiet week or a coverage gap.",
      "- Verify camera/session uptime for the window before reporting an all-clear.",
    ].join("\n");
  }

  const ctx = buildContext(stats, events);
  const userContent = `Weekly monitoring incident data (JSON):\n${ctx}\n\nWrite the weekly quality incident report.`;

  if (isBasetenTextConfigured()) {
    try {
      return await basetenChat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { maxTokens: 2000, temperature: 0.3 },
      );
    } catch (err) {
      console.error(
        "[weeklyReport] Baseten failed, falling back to Claude:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const client = getAnthropic();
  const response = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 2000,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  const block = response.content[0];
  if (block?.type === "text") return block.text.trim();
  return "Unable to generate the weekly report. Review the incident log manually.";
}
