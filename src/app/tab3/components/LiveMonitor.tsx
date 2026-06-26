"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisEvent } from "@/app/lib/types";
import { fetchWithToast } from "@/app/lib/fetchWithToast";
import SeverityFilterChips, {
  type SeverityFilter,
} from "@/app/components/SeverityFilterChips";
import LiveFeed, { type LiveFeedHandle, type LiveObservation } from "./LiveFeed";
import LiveLogs from "./LiveLogs";

interface SessionInfo {
  id: string;
  startedAt: number;
  patientLabel: string;
  /** Set after stop when a recording was saved (see GET session). */
  hasRecording?: boolean;
  /** Seconds from session timeline start to video t=0; seek at event.startTs minus this. */
  recordingSessionOffsetSec?: number;
}

const STUB_LIVE = process.env.NEXT_PUBLIC_STUB_LIVE === "true";

export default function LiveMonitor() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [latestObservation, setLatestObservation] = useState<LiveObservation | null>(null);
  const [patientLabelDraft, setPatientLabelDraft] = useState("");
  /** Opt-in before Start; if false, no MediaRecorder / upload for this session. */
  const [recordSession, setRecordSession] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const feedRef = useRef<LiveFeedHandle>(null);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => closeStream, [closeStream]);

  const shutdownLiveSession = useCallback(async () => {
    await feedRef.current?.stop();
    const id = session?.id;
    if (id) {
      try {
        await fetchWithToast(
          `/api/tab3/sessions/${id}/end`,
          { method: "POST" },
          { errorMessage: "Could not end session cleanly" },
        );
      } catch (err) {
        console.warn("[LiveMonitor] stop request failed:", err);
      }
      try {
        const r = await fetch(`/api/tab3/sessions/${id}`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as {
            session?: { recordingStoragePath?: string; recordingSessionOffsetSec?: number };
          };
          const s = d.session;
          if (s?.recordingStoragePath) {
            setSession((prev) =>
              prev && prev.id === id
                ? {
                    ...prev,
                    hasRecording: true,
                    recordingSessionOffsetSec: s.recordingSessionOffsetSec ?? 0,
                  }
                : prev,
            );
          }
        }
      } catch {
        /* best-effort */
      }
    }
    closeStream();
    setActive(false);
  }, [session, closeStream]);

  const handleStart = useCallback(async () => {
    if (busy || active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithToast(
        "/api/tab3/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientLabel: patientLabelDraft.trim() || undefined,
          }),
        },
        { errorMessage: "Could not start live session" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to start (${res.status})`);
      const id: string = body.sessionId;
      const patientLabel =
        typeof body.patientLabel === "string" && body.patientLabel.trim().length > 0
          ? body.patientLabel.trim()
          : "Patient";
      const startedAt = Date.now();
      setSession({ id, startedAt, patientLabel });
      setEvents([]);
      setActive(true);

      try {
        const detailRes = await fetch(`/api/tab3/sessions/${id}`, { cache: "no-store" });
        if (detailRes.ok) {
          const detail = await detailRes.json();
          if (Array.isArray(detail.events) && detail.events.length > 0) {
            setEvents(detail.events as AnalysisEvent[]);
          }
        }
      } catch {
        /* hydration is best-effort */
      }

      const es = new EventSource(`/api/tab3/sessions/${id}/stream`);
      eventSourceRef.current = es;
      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as { type: string; data?: unknown };
          if (parsed.type === "event" && parsed.data) {
            setEvents((prev) => {
              const evt = parsed.data as AnalysisEvent;
              if (prev.some((e) => e.id === evt.id)) return prev;
              return [...prev, evt];
            });
          } else if (parsed.type === "play_alert") {
            const data = parsed.data as { audioPath?: string } | undefined;
            if (data?.audioPath) {
              const audio = new Audio(`/api/tab3/alerts/${data.audioPath}`);
              audio.play().catch((err) =>
                console.error("[LiveMonitor] audio playback failed:", err),
              );
            }
          } else if (parsed.type === "session_ended") {
            closeStream();
            setActive(false);
          }
        } catch (err) {
          console.warn("[LiveMonitor] bad SSE payload:", err);
        }
      };
      es.onerror = () => {
        /* browser auto-reconnects unless we close */
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setActive(false);
      setSession(null);
    } finally {
      setBusy(false);
    }
  }, [busy, active, closeStream, patientLabelDraft]);

  const handleStop = useCallback(async () => {
    if (busy || !session) return;
    setBusy(true);
    try {
      await shutdownLiveSession();
    } finally {
      setBusy(false);
    }
  }, [busy, session, shutdownLiveSession]);

  const sortedEvents = events;

  const severityCounts = useMemo(() => {
    const counts: Partial<Record<SeverityFilter, number>> = { all: sortedEvents.length };
    for (const e of sortedEvents) {
      counts[e.severity] = (counts[e.severity] ?? 0) + 1;
    }
    return counts;
  }, [sortedEvents]);

  const filteredLogEvents = useMemo(() => {
    if (severityFilter === "all") return sortedEvents;
    return sortedEvents.filter((e) => e.severity === severityFilter);
  }, [sortedEvents, severityFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#09090f] text-[15px] text-slate-200 lg:flex-row">
      <section className="flex w-full min-w-0 flex-col gap-4 border-b border-white/10 p-6 lg:basis-[55%] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Live Monitor</h1>
            <p className="mt-1 text-xs text-slate-400">
              {STUB_LIVE
                ? "Stub mode: random observations POST to /api/tab3/ingest every 4s (no Overshoot, no camera). Events stream over SSE."
                : "Overshoot RealtimeVision in the browser (clip mode, default clip sampling). Results POST to /api/tab3/ingest; events stream over SSE."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!active && (
              <>
                <label className="flex min-w-[140px] max-w-[220px] flex-1 items-center gap-2">
                  <span className="sr-only">Patient label</span>
                  <input
                    type="text"
                    value={patientLabelDraft}
                    onChange={(e) => setPatientLabelDraft(e.target.value)}
                    placeholder="Patient label"
                    disabled={busy}
                    className="w-full rounded-md border border-white/15 bg-[#0c0c12] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/40 focus:outline-none disabled:opacity-50"
                  />
                </label>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={recordSession}
                    onChange={(e) => setRecordSession(e.target.checked)}
                    disabled={busy}
                    className="h-3.5 w-3.5 rounded border-white/25 bg-[#0c0c12] text-emerald-500 focus:ring-emerald-500/40 disabled:opacity-50"
                  />
                  Record session video
                </label>
              </>
            )}
            {active ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={busy}
                className="shrink-0 rounded-md border border-red-500/40 bg-red-500/15 px-4 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/25 disabled:opacity-50"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={busy}
                className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-1.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
              >
                Start
              </button>
            )}
          </div>
        </div>

        <LiveFeed
          ref={feedRef}
          sessionId={session?.id ?? null}
          active={active}
          enableRecording={recordSession}
          onError={(err) => {
            setError(err.message);
            void shutdownLiveSession();
          }}
          onObservation={setLatestObservation}
        />

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {session && (
          <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-[#0c0c12] px-3 py-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Session <span className="font-mono text-slate-400">{session.id.slice(0, 8)}</span>
                <span className="text-slate-600"> · </span>
                <span className="text-slate-400">{session.patientLabel}</span>
              </span>
              <span>
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </div>
            {!active && session.hasRecording && (
              <div className="flex flex-col gap-1 border-t border-white/10 pt-2 text-[10px] text-slate-400">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a
                    href={`/api/tab3/sessions/${session.id}/recording`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit font-medium text-emerald-400/90 underline-offset-2 hover:underline"
                  >
                    Open session recording
                  </a>
                  <a
                    href={`/api/tab3/sessions/${session.id}/recording?download=1`}
                    className="w-fit font-medium text-sky-400/90 underline-offset-2 hover:underline"
                    download
                  >
                    Download recording
                  </a>
                </div>
                <span className="text-slate-500">
                  Log times use session seconds (startTs). In the video, seek to max(0, startTs −{" "}
                  {(session.recordingSessionOffsetSec ?? 0).toFixed(2)}s).
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Current status
          </div>
          {latestObservation ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-[#0c0c12] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white capitalize">{latestObservation.eventType.replace(/_/g, " ")}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  latestObservation.severity === "critical" ? "bg-red-500/20 text-red-300" :
                  latestObservation.severity === "urgent" ? "bg-orange-500/20 text-orange-300" :
                  latestObservation.severity === "moderate" ? "bg-yellow-500/20 text-yellow-300" :
                  latestObservation.severity === "low" ? "bg-blue-500/20 text-blue-300" :
                  "bg-emerald-500/20 text-emerald-300"
                }`}>{latestObservation.severity}</span>
              </div>
              {latestObservation.summary && (
                <p className="text-xs text-slate-400 leading-relaxed">{latestObservation.summary}</p>
              )}
              {latestObservation.symptoms.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {latestObservation.symptoms.map((s) => (
                    <span key={s} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{s}</span>
                  ))}
                </div>
              )}
              <span className="text-[10px] text-slate-600">Updated {new Date(latestObservation.at).toLocaleTimeString()}</span>
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-4 text-center text-xs text-slate-500">
              {active ? "Waiting for first inference…" : "Start a session to see live status."}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Key events
            </div>
          </div>
          <SeverityFilterChips
            value={severityFilter}
            onChange={setSeverityFilter}
            counts={severityCounts}
          />
          <LiveLogs events={filteredLogEvents} />
        </div>
      </section>
    </div>
  );
}
