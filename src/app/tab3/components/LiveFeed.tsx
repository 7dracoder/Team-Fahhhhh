"use client";

/**
 * Overshoot bills per second of stream time. Always call vision.stop() on teardown.
 *
 * The API key is browser-exposed in this client-side flow. For production,
 * use a server-mediated flow (e.g. POST /streams server-side, return a LiveKit token
 * to the client, server consumes WebSocket at /ws/streams/{id}).
 *
 * Session recording: browser MediaRecorder on the same camera stream; uploaded on stop
 * to POST /api/tab3/sessions/[id]/recording while the session is still active. Event
 * startTs (session seconds) aligns with video at startTs − recordingSessionOffsetSec.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { EventType, Severity } from "@/app/lib/types";

const STUB_LIVE = process.env.NEXT_PUBLIC_STUB_LIVE === "true";
/** How often to capture a frame and send it for analysis (ms). */
const FRAME_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_LIVE_FRAME_INTERVAL_MS || "4000",
);
/** JPEG quality (0-1) and max width for captured frames sent to the model. */
const FRAME_JPEG_QUALITY = 0.6;
const FRAME_MAX_WIDTH = 768;

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

export interface LiveFeedHandle {
  stop: () => Promise<void>;
}

export interface LiveObservation {
  eventType: string;
  severity: string;
  summary: string;
  symptoms: string[];
  confidence: number;
  at: number;
}

interface Props {
  sessionId: string | null;
  active: boolean;
  /** If false, no browser MediaRecorder / upload (set from Live Monitor before Start). */
  enableRecording?: boolean;
  onError?: (err: Error) => void;
  onObservation?: (obs: LiveObservation) => void;
}

const MAX_INFERENCE_LOGS = 200;

interface InferenceLogEntry {
  id: string;
  at: number;
  mode: string;
  ok: boolean;
  resultText: string;
  error: string | null;
  finishReason: string | null;
  totalLatencyMs: number | null;
  inferenceLatencyMs: number | null;
}

function formatInferenceTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const STUB_EVENT_POOL: Array<{
  eventType: EventType;
  severity: Severity;
  summary: string;
  symptoms: string[];
}> = [
  {
    eventType: "respiratory",
    severity: "urgent",
    summary: "Rapid shallow breathing with hand on chest.",
    symptoms: ["tachypnea", "hand on chest"],
  },
  {
    eventType: "fall",
    severity: "critical",
    summary: "Slumped to the floor, not moving.",
    symptoms: ["slumped posture", "ground level"],
  },
  {
    eventType: "agitation",
    severity: "moderate",
    summary: "Pacing and muttering, increasingly restless.",
    symptoms: ["pacing", "muttering"],
  },
  {
    eventType: "unresponsive",
    severity: "urgent",
    summary: "Slumped in chair, eyes closed, no response to stimuli.",
    symptoms: ["eyes closed", "no movement", "head tilted"],
  },
  {
    eventType: "cardiac",
    severity: "critical",
    summary: "Clutching chest, pale, sweating.",
    symptoms: ["chest pain", "diaphoresis", "pallor"],
  },
  {
    eventType: "anaphylaxis",
    severity: "urgent",
    summary: "Facial swelling, widespread hives on arms, rapid breathing.",
    symptoms: ["facial swelling", "urticaria", "tachypnea"],
  },
  {
    eventType: "vomiting",
    severity: "moderate",
    summary: "Leaning forward, visible retching.",
    symptoms: ["retching", "forward posture"],
  },
  {
    eventType: "environmental",
    severity: "critical",
    summary: "Thick smoke visible near ceiling; patient seated below.",
    symptoms: ["smoke plume", "reduced visibility"],
  },
];

const STUB_NORMAL_EXAMPLES: Array<{
  summary: string;
  symptoms: string[];
}> = [
  {
    summary: "Patient seated calmly, upright posture, looking toward camera.",
    symptoms: ["upright posture", "eyes open", "still hands"],
  },
  {
    summary: "Patient appears to be resting with eyes closed in a relaxed position.",
    symptoms: ["seated", "eyes closed", "no distress"],
  },
  {
    summary: "Patient not clearly visible in frame; background only.",
    symptoms: ["partial view", "unclear figure"],
  },
];

const LiveFeed = forwardRef<LiveFeedHandle, Props>(function LiveFeed(
  { sessionId, active, enableRecording = false, onError, onObservation },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inFlightRef = useRef(false);
  const stubIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  /** Seconds from session timeline start to t=0 of the recorded file. */
  const recordingOffsetSecRef = useRef(0);
  const recorderStartMsRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  const onObservationRef = useRef(onObservation);
  useEffect(() => { onObservationRef.current = onObservation; }, [onObservation]);
  const sessionStartRef = useRef(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [inferenceLogs, setInferenceLogs] = useState<InferenceLogEntry[]>([]);
  const inferenceLogContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const clearStubInterval = useCallback(() => {
    if (stubIntervalRef.current) {
      clearInterval(stubIntervalRef.current);
      stubIntervalRef.current = null;
    }
  }, []);

  /** Capture the current video frame as a base64 JPEG (no data: prefix). */
  const captureFrameBase64 = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    let canvas = captureCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      captureCanvasRef.current = canvas;
    }
    const scale = Math.min(1, FRAME_MAX_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY);
    return dataUrl.replace(/^data:image\/[a-z]+;base64,/i, "");
  }, []);

  /** Capture one frame, send it for analysis, log + surface the result. */
  const analyzeOnce = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || inFlightRef.current) return;
    const imageBase64 = captureFrameBase64();
    if (!imageBase64) return;
    inFlightRef.current = true;
    const startedAt = Date.now();
    const timestamp = (Date.now() - sessionStartRef.current) / 1000;
    try {
      const res = await fetch("/api/tab3/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, timestamp, imageBase64 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        observation?: LiveObservation | null;
        error?: string;
      };
      const ok = res.ok && !body.error;
      const entry: InferenceLogEntry = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `log-${Date.now()}`,
        at: Date.now(),
        mode: "frame",
        ok,
        resultText: body.observation ? JSON.stringify({ observation: body.observation }) : "",
        error: ok ? null : body.error ?? `HTTP ${res.status}`,
        finishReason: null,
        totalLatencyMs: Date.now() - startedAt,
        inferenceLatencyMs: null,
      };
      setInferenceLogs((prev) => [...prev, entry].slice(-MAX_INFERENCE_LOGS));
      if (body.observation) {
        onObservationRef.current?.({ ...body.observation, at: Date.now() });
      }
      // Concerning events arrive on the UI via the existing SSE stream
      // (the route persists + publishes them), so nothing else to do here.
    } catch (err) {
      console.error("[LiveFeed] analyze frame failed:", err);
    } finally {
      inFlightRef.current = false;
    }
  }, [captureFrameBase64]);

  const stopRecorderAndUpload = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (!mr || mr.state === "inactive") {
      recordedChunksRef.current = [];
      recorderStartMsRef.current = null;
      return;
    }
    const sid = sessionIdRef.current;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      mr.addEventListener("stop", done, { once: true });
      try {
        mr.stop();
      } catch {
        done();
      }
    });
    const chunks = recordedChunksRef.current;
    recordedChunksRef.current = [];
    const blob = new Blob(chunks, { type: mr.mimeType || "video/webm" });
    const durationSec =
      recorderStartMsRef.current != null
        ? (Date.now() - recorderStartMsRef.current) / 1000
        : 0;
    recorderStartMsRef.current = null;
    const offsetSec = recordingOffsetSecRef.current;
    if (!sid || blob.size < 32) return;
    const fd = new FormData();
    fd.append("file", blob, "session.webm");
    fd.append("sessionOffsetSec", String(offsetSec));
    fd.append("durationSec", String(durationSec));
    fd.append("mimeType", mr.mimeType || "video/webm");
    try {
      const res = await fetch(`/api/tab3/sessions/${sid}/recording`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("[LiveFeed] recording upload failed:", res.status, t);
      }
    } catch (err) {
      console.error("[LiveFeed] recording upload failed:", err);
    }
  }, []);

  const stopVision = useCallback(async () => {
    await stopRecorderAndUpload();
    clearStubInterval();
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    inFlightRef.current = false;
    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setReady(false);
  }, [clearStubInterval, stopRecorderAndUpload]);

  useImperativeHandle(
    ref,
    () => ({
      stop: async () => {
        await stopVision();
      },
    }),
    [stopVision],
  );

  const runEmergencyTeardown = useCallback(() => {
    void stopVision();
  }, [stopVision]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        runEmergencyTeardown();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", runEmergencyTeardown);
    window.addEventListener("beforeunload", runEmergencyTeardown);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", runEmergencyTeardown);
      window.removeEventListener("beforeunload", runEmergencyTeardown);
    };
  }, [runEmergencyTeardown]);

  useEffect(() => {
    let cancelled = false;

    if (!active || !sessionId) {
      void stopVision();
      return;
    }

    setError(null);
    setInferenceLogs([]);
    sessionStartRef.current = Date.now();

    if (STUB_LIVE) {
      setReady(true);
      const postStub = () => {
        if (cancelled || !sessionId) return;
        const spec =
          STUB_EVENT_POOL[Math.floor(Math.random() * STUB_EVENT_POOL.length)];
        const normal =
          STUB_NORMAL_EXAMPLES[
            Math.floor(Math.random() * STUB_NORMAL_EXAMPLES.length)
          ];
        const payload =
          Math.random() < 0.35
            ? {
                observation: {
                  eventType: "normal" as const,
                  severity: "normal" as const,
                  summary: normal.summary,
                  symptoms: normal.symptoms,
                  confidence: 0.75 + Math.random() * 0.2,
                },
              }
            : {
                observation: {
                  eventType: spec.eventType,
                  severity: spec.severity,
                  summary: spec.summary,
                  symptoms: spec.symptoms,
                  confidence: 0.7 + Math.random() * 0.25,
                },
              };
        const resultJson = JSON.stringify(payload);
        const stubEntry: InferenceLogEntry = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `log-${Date.now()}`,
          at: Date.now(),
          mode: "clip",
          ok: true,
          resultText: resultJson,
          error: null,
          finishReason: "stop",
          totalLatencyMs: null,
          inferenceLatencyMs: null,
        };
        setInferenceLogs((prev) => [...prev, stubEntry].slice(-MAX_INFERENCE_LOGS));
        try {
          const parsed = JSON.parse(resultJson) as { observation?: LiveObservation };
          if (parsed.observation) onObservationRef.current?.({ ...parsed.observation, at: Date.now() });
        } catch { /* ignore */ }
        const elapsed = (Date.now() - sessionStartRef.current) / 1000;
        void fetch("/api/tab3/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            timestamp: elapsed,
            result: resultJson,
          }),
        }).catch((err) => console.error("[LiveFeed] stub ingest failed:", err));
      };
      postStub();
      stubIntervalRef.current = setInterval(postStub, 4000);
      return () => {
        cancelled = true;
        void stopVision();
      };
    }

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        mediaStreamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            /* autoplay restrictions; element has autoPlay attr */
          });
        }

        if (enableRecording && typeof MediaRecorder !== "undefined") {
          try {
            const mime = pickRecorderMime();
            const mr = mime
              ? new MediaRecorder(stream, { mimeType: mime })
              : new MediaRecorder(stream);
            recordedChunksRef.current = [];
            recordingOffsetSecRef.current =
              (Date.now() - sessionStartRef.current) / 1000;
            recorderStartMsRef.current = Date.now();
            mr.ondataavailable = (e) => {
              if (e.data.size > 0) recordedChunksRef.current.push(e.data);
            };
            mr.onerror = (ev) => {
              console.error("[LiveFeed] MediaRecorder error:", ev);
            };
            mr.start(1000);
            mediaRecorderRef.current = mr;
          } catch (recErr) {
            console.warn("[LiveFeed] MediaRecorder not started:", recErr);
          }
        }

        setReady(true);

        // Kick off the frame-analysis loop. First frame after a short delay so
        // the camera has time to expose; then every FRAME_INTERVAL_MS.
        setTimeout(() => {
          if (!cancelled) void analyzeOnce();
        }, 1200);
        captureIntervalRef.current = setInterval(() => {
          void analyzeOnce();
        }, FRAME_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.error("[LiveFeed] camera start failed:", e);
        setError(e.message);
        onErrorRef.current?.(e);
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      void stopVision();
    };
  }, [active, sessionId, stopVision, enableRecording, analyzeOnce]);

  useEffect(() => {
    if (inferenceLogs.length === 0) return;
    const el = inferenceLogContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [inferenceLogs.length]);

  return (
    <div className="flex min-h-0 w-full flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
        />
        {active && ready && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Live
          </div>
        )}
        {!active && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Camera off. Press Start to begin a session.
          </div>
        )}
        {STUB_LIVE && active && ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-4 text-center text-xs text-slate-400">
            Stub mode: no camera analysis. Random observations POST to /api/tab3/ingest
            every 4s.
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {active && (
        <div className="flex min-h-0 max-h-52 flex-col rounded-lg border border-white/10 bg-[#0c0c12]">
          <div className="shrink-0 border-b border-white/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Inference log (each clip / frame result)
          </div>
          <div ref={inferenceLogContainerRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {inferenceLogs.length === 0 ? (
              <div className="px-1 py-3 text-center text-[11px] text-slate-500">
                {STUB_LIVE
                  ? "Waiting for stub ingest…"
                  : "Waiting for model output…"}
              </div>
            ) : (
              <ul className="flex flex-col gap-2 font-mono text-[10px] leading-relaxed text-slate-300">
                {inferenceLogs.map((log) => (
                  <li
                    key={log.id}
                    className="rounded border border-white/5 bg-black/40 px-2 py-1.5 break-words whitespace-pre-wrap"
                  >
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-slate-500">
                      <span>{formatInferenceTime(log.at)}</span>
                      <span className="text-slate-400">{log.mode}</span>
                      <span className={log.ok ? "text-emerald-400/90" : "text-red-400/90"}>
                        {log.ok ? "ok" : "fail"}
                      </span>
                      {log.finishReason != null && (
                        <span>finish:{String(log.finishReason)}</span>
                      )}
                      {log.totalLatencyMs != null && (
                        <span>{Math.round(log.totalLatencyMs)}ms total</span>
                      )}
                      {log.inferenceLatencyMs != null && (
                        <span>{Math.round(log.inferenceLatencyMs)}ms infer</span>
                      )}
                    </div>
                    {log.error && (
                      <div className="text-red-300/90">{log.error}</div>
                    )}
                    {log.resultText ? (
                      <div className="text-slate-400">{log.resultText}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default LiveFeed;
