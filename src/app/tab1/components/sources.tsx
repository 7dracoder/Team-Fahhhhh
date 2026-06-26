"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Patient } from "@/app/tab1/types";
import { SIM_SCRIPTS } from "@/app/tab1/data/sim-scripts";
import Dashboard from "./Dashboard";

const SAMPLE_INTERVAL_MS = 2000; // decrease during demo? (if able to deal w/ rate limit)
const TRIGGER_COOLDOWN_MS = 15000;
const LYING_CONFIRM_MS = 2000;
const POSE_INTERVAL_MS = 120; // ~8fps inference, draw skeleton every rAF
const TRIAGE_ORDER: Record<string, number> = { CRITICAL: 0, URGENT: 1, STABLE: 2, MONITORING: 3 };

// COCO 17-keypoint skeleton connections for YOLOv8 pose
const POSE_CONNECTIONS = [
  [0,1],[0,2],[1,3],[2,4],          // face
  [5,6],[5,7],[7,9],[6,8],[8,10],   // arms
  [5,11],[6,12],[11,12],            // torso
  [11,13],[13,15],[12,14],[14,16],  // legs
];

function wordSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/));
  const wb = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  return intersection / Math.max(wa.size, wb.size, 1);
}

// find an existing patient whose descriptor is ≥45% word-overlap with the incoming one
function findSimilarKey(map: Record<string, Patient>, incoming: string, camLabel: string): string | null {
  let bestKey: string | null = null;
  let bestScore = 0.45;
  for (const [key, existing] of Object.entries(map)) {
    if (existing.cameraLabel !== camLabel) continue;
    const score = wordSimilarity(incoming, existing.id);
    if (score > bestScore) { bestScore = score; bestKey = key; }
  }
  return bestKey;
}

interface Keypoint { x: number; y: number; conf: number; }
type Posture = "standing" | "sitting" | "lying";
// Pose data sent back from the YOLOv8 worker (posture already classified off-thread)
interface WorkerPose { keypoints: Keypoint[]; score: number; posture: Posture; }

// crop video frame to each detected person's pose bounding box, sorted left-to-right
function computePersonCrops(video: HTMLVideoElement, poses: WorkerPose[]): string[] {
  if (poses.length === 0 || video.readyState < 2 || video.videoWidth === 0) return [];
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const tmp = document.createElement("canvas");
  const ctx = tmp.getContext("2d");
  if (!ctx) return [];

  const sorted = [...poses].sort((a, b) => {
    const cx = (p: WorkerPose) => { const xs = p.keypoints.filter(k=>k.conf>0.3).map(k=>k.x); return xs.length ? (Math.min(...xs)+Math.max(...xs))/2 : 0.5; };
    return cx(a) - cx(b);
  });

  return sorted.flatMap(pose => {
    const vis = pose.keypoints.filter(k => k.conf > 0.3);
    if (vis.length < 3) return [];
    const xs = vis.map(k => k.x), ys = vis.map(k => k.y);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    // add padding: 15% sides, 20% top (head room), 10% bottom
    const x1 = Math.max(0, Math.min(...xs) - bw * 0.15);
    const y1 = Math.max(0, Math.min(...ys) - bh * 0.20);
    const x2 = Math.min(1, Math.max(...xs) + bw * 0.15);
    const y2 = Math.min(1, Math.max(...ys) + bh * 0.10);
    const pw = (x2 - x1) * vw, ph = (y2 - y1) * vh;
    if (pw < 10 || ph < 10) return [];
    tmp.width = Math.round(pw);
    tmp.height = Math.round(ph);
    ctx.drawImage(video, x1 * vw, y1 * vh, pw, ph, 0, 0, tmp.width, tmp.height);
    return [tmp.toDataURL("image/jpeg", 0.82)];
  });
}

// draw skeleton overlay — green=standing, amber=sitting, red=lying
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Keypoint[],
  w: number,
  h: number,
  posture: Posture,
) {
  if (w === 0 || h === 0) return;
  const color = posture === "lying" ? "#ef4444" : posture === "sitting" ? "#f59e0b" : "#22c55e";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  for (const [a, b] of POSE_CONNECTIONS) {
    const ka = keypoints[a];
    const kb = keypoints[b];
    if (!ka || !kb || ka.conf < 0.3 || kb.conf < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(ka.x * w, ka.y * h);
    ctx.lineTo(kb.x * w, kb.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const kp of keypoints) {
    if (kp.conf < 0.3) continue;
    ctx.beginPath();
    ctx.arc(kp.x * w, kp.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface PoseState {
  lastPosture: Posture | null;
  lyingStartMs: number | null;
  lastTriggerMs: number;
}

interface Event {
  time: string;
  msg: string;
  level: string;
}

interface CameraDevice { deviceId: string; label: string; }

interface ActiveCamera {
  deviceId: string;
  label: string;
  stream: MediaStream;
  analyzing: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
}

interface Props { onPatientsChange?: (patients: Patient[]) => void; }

export default function HospitalTriageAI({ onPatientsChange }: Props = {}) {
  // per-camera video/canvas elements stored by deviceId
  const videoRefs   = useRef<Record<string, HTMLVideoElement | null>>({});
  const canvasRefs  = useRef<Record<string, HTMLCanvasElement | null>>({});
  const overlayRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const activeCamerasRef = useRef<Record<string, ActiveCamera>>({});

  // YOLOv8 worker refs — one worker per active source for true parallel inference
  const workersRef     = useRef<Record<string, Worker>>({});
  const lastPosesRef   = useRef<Record<string, WorkerPose[]>>({});   // keyed by deviceId or filename
  const pendingRef     = useRef<Record<string, boolean>>({});
  const lastInfTimeRef = useRef<Record<string, number>>({});
  const poseStateRef   = useRef<Record<string, PoseState>>({});
  const rafIdRef       = useRef<Record<string, number>>({});

  // per-simulation refs — keyed by filename (multiple sims can run concurrently)
  const simVideoRefs     = useRef<Record<string, HTMLVideoElement | null>>({});
  const simCanvasRefs    = useRef<Record<string, HTMLCanvasElement | null>>({});
  const simOverlayRefs   = useRef<Record<string, HTMLCanvasElement | null>>({});
  const simPoseStates    = useRef<Record<string, PoseState>>({});
  const simRafIds        = useRef<Record<string, number>>({});
  const simIntervals     = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const simAnalyzingRefs = useRef<Record<string, boolean>>({});
  const simDoneRefs      = useRef<Record<string, boolean>>({});
  const simEndedHandlers  = useRef<Record<string, () => void>>({});
  const simScriptTimers   = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});
  const simStartTimes     = useRef<Record<string, number>>({});
  // tracks which IDs in pose refs belong to sims vs cameras
  const simFilenamesRef   = useRef<Set<string>>(new Set());

  const [yoloReady, setYoloReady] = useState(false);
  const [poseMode, setPoseMode] = useState<"mediapipe" | "yolo">("mediapipe");
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [activeCameras, setActiveCameras] = useState<Record<string, ActiveCamera>>({});
  const [patients, setPatients] = useState<Patient[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [simulatingFiles, setSimulatingFiles] = useState<string[]>([]);
  const [simAnalyzing, setSimAnalyzing] = useState<Record<string, boolean>>({});
  const [simElapsed, setSimElapsed] = useState<Record<string, number>>({});
  const [videoFiles, setVideoFiles] = useState<string[]>([]);

  useEffect(() => { onPatientsChange?.(patients); }, [patients, onPatientsChange]);
  useEffect(() => { activeCamerasRef.current = activeCameras; }, [activeCameras]);

  // tick elapsed timer for active simulations
  useEffect(() => {
    if (simulatingFiles.length === 0) return;
    const iv = setInterval(() => {
      setSimElapsed(() => {
        const next: Record<string, number> = {};
        for (const f of Object.keys(simStartTimes.current)) {
          next[f] = Math.floor((Date.now() - simStartTimes.current[f]) / 1000);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [simulatingFiles]);

  const addEvent = useCallback((msg: string, level = "info") => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setEvents((prev) => [{ time, msg, level }, ...prev].slice(0, 30));
  }, []);

  const lastSpeakRef = useRef(0);
  const speakAlert = useCallback(async (text: string) => {
    const now = Date.now();
    if (now - lastSpeakRef.current < 30_000) return; // 30-second cooldown between alerts
    lastSpeakRef.current = now;
    try {
      const res = await fetch("/api/tab1/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      // TTS failure is non-critical, silently ignore
    }
  }, []);

  const captureFromVideo = useCallback((video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null => {
    if (video.readyState < 2) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    canvas.width = 640; // increase if doing longer distance demo (16 : 9)
    canvas.height = 360; // increase if doing longer distance demo
    ctx.drawImage(video, 0, 0, 320, 180);
    return canvas.toDataURL("image/jpeg", 0.65);
  }, []);

  // IMPORTANT: if anomaly detected by YOLOv8, send to api route.ts and analyze returned json
  const analyzeFrame = useCallback(async (deviceId: string, cameraLabel: string, frameData: string) => {
    const isSim = simFilenamesRef.current.has(deviceId);
    const video = isSim ? simVideoRefs.current[deviceId] : videoRefs.current[deviceId];
    const crops = video ? computePersonCrops(video, lastPosesRef.current[deviceId] ?? []) : [];

    if (isSim) {
      simAnalyzingRefs.current[deviceId] = true;
      setSimAnalyzing(prev => ({ ...prev, [deviceId]: true }));
    } else {
      setActiveCameras((s) => s[deviceId] ? { ...s, [deviceId]: { ...s[deviceId], analyzing: true } } : s);
    }
    try {
      const base64 = frameData.split(",")[1];
      const res = await fetch("/api/tab1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      const parsed = await res.json();
      if (!res.ok) throw new Error(parsed.error || "Analysis failed");
      const now = new Date().toLocaleTimeString("en-US", { hour12: false });

      if (parsed.patients?.length > 0) {
        setPatients((prev) => {
          const map: Record<string, Patient> = Object.fromEntries(prev.map((p) => [`${p.cameraLabel}:${p.id}`, p]));
          (parsed.patients as Patient[]).forEach((p, i) => {
            const exactKey = `${cameraLabel}:${p.id}`;
            // prefer exact match, fall back to fuzzy match to avoid duplicates
            const key = map[exactKey] ? exactKey : (findSimilarKey(map, p.id, cameraLabel) ?? exactKey);
            // keep existing thumbnail — only set on first detection so the card doesn't flicker
            const thumbnail = map[key]?.thumbnail ?? crops[i] ?? crops[0] ?? frameData;
            map[key] = { ...p, thumbnail, cameraLabel, firstSeen: map[key]?.firstSeen || now, lastSeen: now };
          });
          return Object.values(map).sort(
            (a, b) => (TRIAGE_ORDER[a.triage] ?? 9) - (TRIAGE_ORDER[b.triage] ?? 9)
          );
        });
        const critical = (parsed.patients as Patient[]).filter((p) => p.triage === "CRITICAL");
        if (critical.length > 0) {
          addEvent(`[${cameraLabel}] ALERT: ${critical.length} critical patient(s) detected`, "critical");
          const spokenLabel = cameraLabel.replace(/\.[a-zA-Z0-9]+$/, "");
          const msg = critical.length === 1
            ? `Critical patient in ${spokenLabel}. ${critical[0].reason}. Immediate attention needed.`
            : `${critical.length} critical patients in ${spokenLabel}. Immediate attention needed.`;
          speakAlert(msg);
        } else {
          addEvent(`[${cameraLabel}] ${parsed.patients.length} patient(s) detected`, "info");
        }
      } else {
        addEvent(`[${cameraLabel}] No patients detected in frame`, "muted");
      }

    } catch (err) {
      addEvent(`[${cameraLabel}] Analysis error: ` + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      if (isSim) {
        simAnalyzingRefs.current[deviceId] = false;
        setSimAnalyzing(prev => ({ ...prev, [deviceId]: false }));
      } else {
        setActiveCameras((s) => s[deviceId] ? { ...s, [deviceId]: { ...s[deviceId], analyzing: false } } : s);
      }
    }
  }, [addEvent, speakAlert]);

  // stable callback refs so the worker onmessage closure never goes stale
  const analyzeFrameRef    = useRef(analyzeFrame);
  const addEventRef        = useRef(addEvent);
  const captureFromVideoRef = useRef(captureFromVideo);
  useEffect(() => { analyzeFrameRef.current = analyzeFrame; }, [analyzeFrame]);
  useEffect(() => { addEventRef.current = addEvent; }, [addEvent]);
  useEffect(() => { captureFromVideoRef.current = captureFromVideo; }, [captureFromVideo]);

  // Attach the shared onmessage handler to a freshly spawned worker.
  // Uses stable refs only — safe to call outside React render.
  const attachWorkerHandler = useCallback((worker: Worker) => {
    worker.onmessage = (e: MessageEvent) => {
      const { type, id, poses, error } = e.data as {
        type: string; id?: string; poses?: WorkerPose[]; error?: string;
      };

      if (type === "ready") { setYoloReady(true); setPoseMode(e.data.mode ?? "mediapipe"); return; }
      if (type === "mode-change") { setPoseMode(e.data.mode); return; }
      if (type === "load-error") { console.warn("[pose worker] failed to load:", error); return; }

      if (type === "poses" && id != null) {
        pendingRef.current[id] = false;
        lastPosesRef.current[id] = poses ?? [];

        const isSim = simFilenamesRef.current.has(id);
        const state = isSim ? simPoseStates.current[id] : poseStateRef.current[id];
        if (!state) return;

        const now = Date.now();
        if ((poses ?? []).length === 0) { state.lastPosture = null; state.lyingStartMs = null; }

        for (const pose of (poses ?? [])) {
          const { posture } = pose;
          const fell = state.lastPosture === "standing" && posture === "lying";
          if (fell) state.lyingStartMs = now;
          if (posture !== "lying") state.lyingStartMs = null;
          const sustainedLying = posture === "lying" && state.lyingStartMs !== null && now - state.lyingStartMs > LYING_CONFIRM_MS;

          if (isSim) {
            if (
              (fell || sustainedLying) &&
              now - state.lastTriggerMs > TRIGGER_COOLDOWN_MS &&
              !simAnalyzingRefs.current[id] &&
              !simDoneRefs.current[id]
            ) {
              state.lastTriggerMs = now;
              const video = simVideoRefs.current[id];
              const canvas = simCanvasRefs.current[id];
              if (video && canvas) {
                const frameData = captureFromVideoRef.current(video, canvas);
                if (frameData) {
                  addEventRef.current(`[${id}] Anomaly detected — triggering Claude`, "info");
                  analyzeFrameRef.current(id, id, frameData);
                }
              }
            }
          } else {
            const cam = activeCamerasRef.current[id];
            const label = cam?.label ?? id;
            const canvas = canvasRefs.current[id];
            if ((fell || sustainedLying) && now - state.lastTriggerMs > TRIGGER_COOLDOWN_MS && canvas) {
              state.lastTriggerMs = now;
              const video = videoRefs.current[id];
              if (video) {
                const frameData = captureFromVideoRef.current(video, canvas);
                if (frameData) {
                  addEventRef.current(`[${label}] Anomaly detected — triggering Claude`, "info");
                  analyzeFrameRef.current(id, label, frameData);
                }
              }
            }
          }
          state.lastPosture = posture;
        }
      }
    };
  }, []);

  const spawnWorkerForId = useCallback((id: string) => {
    if (workersRef.current[id]) return;
    const worker = new Worker(new URL("../workers/yolo.worker.ts", import.meta.url));
    attachWorkerHandler(worker);
    worker.postMessage({ type: "load" });
    workersRef.current[id] = worker;
  }, [attachWorkerHandler]);

  const terminateWorkerForId = useCallback((id: string) => {
    workersRef.current[id]?.terminate();
    delete workersRef.current[id];
  }, []);

  // terminate all workers on unmount
  useEffect(() => {
    const workers = workersRef.current;
    return () => { Object.values(workers).forEach(w => w.terminate()); };
  }, []);

  // enumerate available cameras on mount
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const cams = all
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      setDevices(cams);
    });
  }, []);

  // fetch available video files from public/video_samples/
  useEffect(() => {
    fetch("/api/tab1/videos").then((r) => r.json()).then((d) => setVideoFiles(d.videos ?? []));
  }, []);

  const stopPoseLoop = useCallback((deviceId: string) => {
    const id = rafIdRef.current[deviceId];
    if (id) cancelAnimationFrame(id);
    delete rafIdRef.current[deviceId];
    delete poseStateRef.current[deviceId];
    delete lastPosesRef.current[deviceId];
    delete pendingRef.current[deviceId];
    delete lastInfTimeRef.current[deviceId];
    terminateWorkerForId(deviceId);
  }, [terminateWorkerForId]);

  // rAF loop per camera — each camera has its own worker for parallel inference
  const startPoseLoop = useCallback((deviceId: string) => {
    spawnWorkerForId(deviceId);
    poseStateRef.current[deviceId] = { lastPosture: null, lyingStartMs: null, lastTriggerMs: 0 };
    lastPosesRef.current[deviceId] = [];
    pendingRef.current[deviceId] = false;
    lastInfTimeRef.current[deviceId] = 0;

    const loop = () => {
      const video   = videoRefs.current[deviceId];
      const overlay = overlayRefs.current[deviceId];

      if (!video || !overlay || video.readyState < 2) {
        rafIdRef.current[deviceId] = requestAnimationFrame(loop);
        return;
      }

      const w = overlay.offsetWidth;
      const h = overlay.offsetHeight;
      if (w !== overlay.width)  overlay.width  = w;
      if (h !== overlay.height) overlay.height = h;
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, w, h);

      if (ctx && w > 0 && h > 0) {
        for (const pose of (lastPosesRef.current[deviceId] ?? [])) {
          drawSkeleton(ctx, pose.keypoints, w, h, pose.posture);
        }
      }

      const now = Date.now();
      if (!pendingRef.current[deviceId] && now - (lastInfTimeRef.current[deviceId] ?? 0) >= POSE_INTERVAL_MS && workersRef.current[deviceId]) {
        pendingRef.current[deviceId] = true;
        lastInfTimeRef.current[deviceId] = now;
        createImageBitmap(video).then((bitmap) => {
          workersRef.current[deviceId]?.postMessage({ type: "infer", id: deviceId, bitmap }, [bitmap]);
        });
      }

      rafIdRef.current[deviceId] = requestAnimationFrame(loop);
    };
    rafIdRef.current[deviceId] = requestAnimationFrame(loop);
  }, [spawnWorkerForId]);

  const stopSimPoseLoop = useCallback((filename: string) => {
    const id = simRafIds.current[filename];
    if (id) cancelAnimationFrame(id);
    delete simRafIds.current[filename];
    delete lastPosesRef.current[filename];
    delete pendingRef.current[filename];
    delete lastInfTimeRef.current[filename];
    terminateWorkerForId(filename);
  }, [terminateWorkerForId]);

  const startSimPoseLoop = useCallback((filename: string) => {
    spawnWorkerForId(filename);
    simPoseStates.current[filename] = { lastPosture: null, lyingStartMs: null, lastTriggerMs: 0 };
    lastPosesRef.current[filename] = [];
    pendingRef.current[filename] = false;
    lastInfTimeRef.current[filename] = 0;

    const loop = () => {
      if (!simFilenamesRef.current.has(filename)) return; // sim was stopped
      const video   = simVideoRefs.current[filename];
      const overlay = simOverlayRefs.current[filename];

      if (!video || !overlay || video.readyState < 2 || video.ended) {
        simRafIds.current[filename] = requestAnimationFrame(loop);
        return;
      }

      const w = overlay.offsetWidth;
      const h = overlay.offsetHeight;
      if (w !== overlay.width)  overlay.width  = w;
      if (h !== overlay.height) overlay.height = h;
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, w, h);

      if (ctx && w > 0 && h > 0) {
        for (const pose of (lastPosesRef.current[filename] ?? [])) {
          drawSkeleton(ctx, pose.keypoints, w, h, pose.posture);
        }
      }

      if (!pendingRef.current[filename] && Date.now() - (lastInfTimeRef.current[filename] ?? 0) >= POSE_INTERVAL_MS && workersRef.current[filename]) {
        pendingRef.current[filename] = true;
        lastInfTimeRef.current[filename] = Date.now();
        createImageBitmap(video).then((bitmap) => {
          workersRef.current[filename]?.postMessage({ type: "infer", id: filename, bitmap }, [bitmap]);
        });
      }

      simRafIds.current[filename] = requestAnimationFrame(loop);
    };
    simRafIds.current[filename] = requestAnimationFrame(loop);
  }, [spawnWorkerForId]);

  // start/stop pose loops as cameras become active or inactive — each spawns its own worker
  const prevCameraIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(Object.keys(activeCameras));
    for (const id of current) {
      if (!prevCameraIdsRef.current.has(id)) startPoseLoop(id);
    }
    for (const id of prevCameraIdsRef.current) {
      if (!current.has(id)) stopPoseLoop(id);
    }
    prevCameraIdsRef.current = current;
  }, [activeCameras, startPoseLoop, stopPoseLoop]);

  const startSimulation = useCallback((filename: string) => {
    const video = simVideoRefs.current[filename];
    if (!video) return;

    const prevHandler = simEndedHandlers.current[filename];
    if (prevHandler) video.removeEventListener("ended", prevHandler);
    stopSimPoseLoop(filename);
    simDoneRefs.current[filename] = false;
    simFilenamesRef.current.add(filename);
    simStartTimes.current[filename] = Date.now();

    video.src = `/video_samples/${filename}`;
    video.currentTime = 0;
    video.play();
    setSimulatingFiles(prev => [...prev, filename]);
    addEvent(`Simulating: ${filename}`, "info");

    const script = SIM_SCRIPTS[filename];
    startSimPoseLoop(filename);
    if (script) workersRef.current[filename]?.postMessage({ type: "force-yolo" });

    if (script) {
      const timers = script.map((entry) =>
        setTimeout(() => {
          simAnalyzingRefs.current[filename] = true;
          setSimAnalyzing(prev => ({ ...prev, [filename]: true }));
          setTimeout(() => {
            const now = new Date().toLocaleTimeString("en-US", { hour12: false });
            const vid = simVideoRefs.current[filename];
            const crops = vid ? computePersonCrops(vid, lastPosesRef.current[filename] ?? []) : [];
            setPatients(prev => {
              const map: Record<string, Patient> = Object.fromEntries(prev.map(p => [`${p.cameraLabel}:${p.id}`, p]));
              entry.patients.forEach((p, i) => {
                const key = `${filename}:${p.id}`;
                const hardcodedThumb = entry.thumbnails?.[i] ?? null;
                const thumbnail = hardcodedThumb ?? map[key]?.thumbnail ?? crops[i] ?? crops[0];
                map[key] = { ...p, thumbnail, cameraLabel: filename, firstSeen: map[key]?.firstSeen || now, lastSeen: now };
              });
              return Object.values(map).sort((a, b) => (TRIAGE_ORDER[a.triage] ?? 9) - (TRIAGE_ORDER[b.triage] ?? 9));
            });
            simAnalyzingRefs.current[filename] = false;
            setSimAnalyzing(prev => ({ ...prev, [filename]: false }));
            const critical = entry.patients.filter(p => p.triage === "CRITICAL");
            if (critical.length > 0) {
              addEvent(`[${filename}] ALERT: ${critical.length} critical patient(s) detected`, "critical");
              const spokenLabel = filename.replace(/\.[a-zA-Z0-9]+$/, "");
              const msg = critical.length === 1
                ? `Critical patient in ${spokenLabel}. ${critical[0].reason}. Immediate attention needed.`
                : `${critical.length} critical patients in ${spokenLabel}. Immediate attention needed.`;
              speakAlert(msg);
            } else {
              addEvent(`[${filename}] ${entry.patients.length} patient(s) detected`, "info");
            }
          }, entry.analysisMs ?? 1400);
        }, entry.delayMs)
      );
      simScriptTimers.current[filename] = timers;

      // loop video when it ends
      const handleEnded = () => { video.currentTime = 0.5; video.play(); };
      simEndedHandlers.current[filename] = handleEnded;
      video.addEventListener("ended", handleEnded);
    } else {
      // normal live analysis pipeline
      const handleCanPlay = () => {
        video.removeEventListener("canplay", handleCanPlay);
        const canvas = simCanvasRefs.current[filename];
        if (canvas && !simAnalyzingRefs.current[filename]) {
          const frameData = captureFromVideo(video, canvas);
          if (frameData) analyzeFrame(filename, filename, frameData);
        }
      };
      video.addEventListener("canplay", handleCanPlay);

      simIntervals.current[filename] = setInterval(() => {
        if (simAnalyzingRefs.current[filename]) return;
        const canvas = simCanvasRefs.current[filename];
        if (!video || !canvas || video.readyState < 2 || video.ended) return;
        const frameData = captureFromVideo(video, canvas);
        if (frameData) analyzeFrame(filename, filename, frameData);
      }, SAMPLE_INTERVAL_MS);

      const handleEnded = () => {
        simDoneRefs.current[filename] = true;
        const iv = simIntervals.current[filename];
        if (iv) { clearInterval(iv); delete simIntervals.current[filename]; }
        video.currentTime = 0;
        video.play();
        addEvent(`[${filename}] Playback looping — analysis complete`, "muted");
      };
      simEndedHandlers.current[filename] = handleEnded;
      video.addEventListener("ended", handleEnded);
    }
  }, [addEvent, analyzeFrame, captureFromVideo, speakAlert, startSimPoseLoop, stopSimPoseLoop]);

  const stopSimulation = useCallback((filename: string) => {
    stopSimPoseLoop(filename);
    (simScriptTimers.current[filename] ?? []).forEach(clearTimeout);
    delete simScriptTimers.current[filename];
    const iv = simIntervals.current[filename];
    if (iv) { clearInterval(iv); delete simIntervals.current[filename]; }
    const video = simVideoRefs.current[filename];
    if (video) {
      const handler = simEndedHandlers.current[filename];
      if (handler) video.removeEventListener("ended", handler);
      video.pause();
      video.src = "";
    }
    delete simEndedHandlers.current[filename];
    delete simDoneRefs.current[filename];
    delete simAnalyzingRefs.current[filename];
    simFilenamesRef.current.delete(filename);
    delete simStartTimes.current[filename];
    setSimElapsed(prev => { const next = { ...prev }; delete next[filename]; return next; });
    setSimulatingFiles(prev => prev.filter(f => f !== filename));
    addEvent(`Simulation stopped: ${filename}`, "muted");
  }, [addEvent, stopSimPoseLoop]);

  const startCamera = useCallback(async (device: CameraDevice) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.deviceId }, width: 640, height: 480 },
      });

      const intervalId = setInterval(() => {
        const video  = videoRefs.current[device.deviceId];
        const canvas = canvasRefs.current[device.deviceId];
        if (!video || !canvas) return;
        const frameData = captureFromVideo(video, canvas);
        if (frameData) analyzeFrame(device.deviceId, activeCamerasRef.current[device.deviceId]?.label ?? device.label, frameData);
      }, SAMPLE_INTERVAL_MS);

      const cam: ActiveCamera = { deviceId: device.deviceId, label: device.label, stream, analyzing: false, intervalId };
      setActiveCameras((prev) => ({ ...prev, [device.deviceId]: cam }));

      const triggerFirst = () => {
        const video  = videoRefs.current[device.deviceId];
        const canvas = canvasRefs.current[device.deviceId];
        if (video && canvas) {
          video.removeEventListener("canplay", triggerFirst);
          const frameData = captureFromVideo(video, canvas);
          if (frameData) analyzeFrame(device.deviceId, device.label, frameData);
        }
      };
      setTimeout(() => {
        const video = videoRefs.current[device.deviceId];
        if (video) video.addEventListener("canplay", triggerFirst);
      }, 0);

      addEvent(`${device.label} started`, "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addEvent(`${device.label}: ` + (msg.includes("denied") ? "Camera access denied." : msg), "error");
    }
  }, [addEvent, analyzeFrame, captureFromVideo]);

  const stopCamera = useCallback((deviceId: string) => {
    const cam = activeCamerasRef.current[deviceId];
    if (!cam) return;
    cam.stream.getTracks().forEach((t) => t.stop());
    if (cam.intervalId) clearInterval(cam.intervalId);
    stopPoseLoop(deviceId);
    addEvent(`${cam.label} stopped`, "muted");
    setActiveCameras((prev) => { const next = { ...prev }; delete next[deviceId]; return next; });
  }, [addEvent, stopPoseLoop]);

  // cleanup all cameras and sims on unmount
  useEffect(() => () => {
    Object.values(activeCamerasRef.current).forEach((cam) => {
      cam.stream.getTracks().forEach((t) => t.stop());
      if (cam.intervalId) clearInterval(cam.intervalId);
    });
    Object.keys(rafIdRef.current).forEach((id) => cancelAnimationFrame(rafIdRef.current[id]));
    Object.values(simRafIds.current).forEach((id) => cancelAnimationFrame(id));
    Object.values(simIntervals.current).forEach((iv) => clearInterval(iv));
    Object.values(simScriptTimers.current).flat().forEach(clearTimeout);
  }, []);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const handleDismiss = useCallback((key: string) => {
    setDismissed((prev) => new Set([...prev, key]));
  }, []);
  const visible = patients.filter((p) => !dismissed.has(`${p.cameraLabel}:${p.id}`));

  const totalTiles = Object.values(activeCameras).length + simulatingFiles.length;

  // html
  return (
    <div style={{ fontFamily: "var(--font-sans)", minHeight: "calc(100vh - 52px)", background: "#09090f", color: "white" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        .live-dot { animation: blink 1.2s ease infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes pulse-critical { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.7),0 0 0 0 rgba(239,68,68,0.3)} 50%{box-shadow:0 0 0 4px rgba(239,68,68,0.4),0 0 16px 4px rgba(239,68,68,0.2)} }
        @keyframes pulse-urgent { 0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.7),0 0 0 0 rgba(249,115,22,0.3)} 50%{box-shadow:0 0 0 4px rgba(249,115,22,0.4),0 0 16px 4px rgba(249,115,22,0.2)} }
        .alert-critical { border-color: rgb(239,68,68) !important; animation: pulse-critical 1.4s ease-in-out infinite; }
        .alert-urgent   { border-color: rgb(249,115,22) !important; animation: pulse-urgent 1.8s ease-in-out infinite; }
      `}</style>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 440px", minHeight: "calc(100vh - 52px)" }}>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", borderRight: "1px solid rgba(255,255,255,0.08)" }}>

          {/* Pose model status indicator */}
          <div style={{ fontSize: 11 }}>
            {yoloReady
              ? poseMode === "yolo"
                ? <span style={{ color: "#f59e0b" }}>● YOLOv8 active — 3+ people detected</span>
                : <span style={{ color: "#22c55e" }}>● MediaPipe active — fast single/dual person tracking</span>
              : <span style={{ color: "#475569" }}>○ Loading pose model…</span>
            }
          </div>

          {/* Video grid — cameras + active simulations */}
          <div style={{ display: "grid", gridTemplateColumns: totalTiles >= 3 ? "1fr 1fr 1fr" : totalTiles === 2 ? "1fr 1fr" : "1fr", gap: "12px" }}>
            {Object.values(activeCameras).map((cam) => {
              const camPatients = visible.filter(p => p.cameraLabel === cam.deviceId || p.cameraLabel === cam.label);
              const hasCritical = camPatients.some(p => p.triage === "CRITICAL");
              const hasUrgent   = !hasCritical && camPatients.some(p => p.triage === "URGENT");
              const alertClass  = hasCritical ? "alert-critical" : hasUrgent ? "alert-urgent" : "";
              return (
              <div key={cam.deviceId} className={alertClass} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden", position: "relative", aspectRatio: "16/9" }}>
                <video ref={(el) => { videoRefs.current[cam.deviceId] = el; if (el && el.srcObject !== cam.stream) { el.srcObject = cam.stream; el.play(); } }} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline autoPlay />
                <canvas ref={(el) => { canvasRefs.current[cam.deviceId] = el; }} style={{ display: "none" }} />
                <canvas
                  ref={(el) => { overlayRefs.current[cam.deviceId] = el; }}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                />
                <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: "6px", background: "var(--color-background-danger)", padding: "3px 8px", borderRadius: "var(--border-radius-md)" }}>
                  <div className="live-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-text-danger)" }} />
                  <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-danger)" }}>{cam.label}</span>
                </div>
                {cam.analyzing && (
                  <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: "5px", background: "var(--color-background-info)", padding: "3px 8px", borderRadius: "var(--border-radius-md)" }}>
                    <svg className="spin" width="9" height="9" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="var(--color-text-info)" strokeWidth="1.5" strokeDasharray="6 8" fill="none"/></svg>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-info)" }}>Analyzing</span>
                  </div>
                )}
              </div>
              );
            })}

            {/* Pre-render ALL sim video elements (hidden when inactive) so refs are always available before startSimulation runs */}
            {videoFiles.map((filename) => {
              const active = simulatingFiles.includes(filename);
              const simPatients = visible.filter(p => p.cameraLabel === filename);
              const simCritical = simPatients.some(p => p.triage === "CRITICAL");
              const simUrgent   = !simCritical && simPatients.some(p => p.triage === "URGENT");
              const simAlert    = simCritical ? "alert-critical" : simUrgent ? "alert-urgent" : "";
              return (
                <div key={filename} className={active ? simAlert : ""} style={{ display: active ? "block" : "none", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden", position: "relative", aspectRatio: "16/9" }}>
                  <video ref={(el) => { simVideoRefs.current[filename] = el; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
                  <canvas ref={(el) => { simCanvasRefs.current[filename] = el; }} style={{ display: "none" }} />
                  <canvas
                    ref={(el) => { simOverlayRefs.current[filename] = el; }}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                  />
                  {active && (
                    <>
                      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: "6px", background: "var(--color-background-danger)", padding: "3px 8px", borderRadius: "var(--border-radius-md)" }}>
                        <div className="live-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-text-danger)" }} />
                        <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-danger)" }}>{filename.replace(/\.[^.]+$/, "")}</span>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--color-text-danger)", opacity: 0.75 }}>
                          {(() => { const s = simElapsed[filename] ?? 0; return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; })()}
                        </span>
                      </div>
                      {simAnalyzing[filename] && (
                        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: "5px", background: "var(--color-background-info)", padding: "3px 8px", borderRadius: "var(--border-radius-md)" }}>
                          <svg className="spin" width="9" height="9" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="var(--color-text-info)" strokeWidth="1.5" strokeDasharray="6 8" fill="none"/></svg>
                          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-info)" }}>Analyzing</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {totalTiles === 0 && (
              <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden", position: "relative", aspectRatio: "16/9" }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="2" y="8" width="28" height="24" rx="3" stroke="var(--color-border-secondary)" strokeWidth="1.5"/><path d="M30 15l8-5v20l-8-5V15z" stroke="var(--color-border-secondary)" strokeWidth="1.5"/><circle cx="16" cy="20" r="5" stroke="var(--color-border-secondary)" strokeWidth="1.5"/></svg>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No active cameras</span>
                </div>
              </div>
            )}
          </div>

          {/* Camera selector */}
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "14px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "10px" }}>Available cameras</div>
            {devices.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>No cameras found. Allow camera access and refresh.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {devices.map((d) => {
                  const active = !!activeCameras[d.deviceId];
                  return (
                    <button key={d.deviceId} onClick={() => active ? stopCamera(d.deviceId) : startCamera(d)}
                      style={{ padding: "6px 14px", borderRadius: "var(--border-radius-md)", border: active ? "0.5px solid var(--color-border-danger)" : "0.5px solid var(--color-border-secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, background: active ? "var(--color-background-danger)" : "var(--color-background-secondary)", color: active ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>
                      {active ? "Stop" : "Start"} · {d.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Event log */}
          <div style={{ background: "#0f1015", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px", flex: 1 }}>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 10, fontWeight: 500 }}>Event log</div>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: "#1e293b" }}>No events yet.</div>
            ) : (
              events.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 12, marginBottom: 6, fontSize: 12, borderBottom: i < events.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", paddingBottom: 6 }}>
                  <span style={{ color: "#1e293b", whiteSpace: "nowrap", fontFamily: "monospace" }}>{e.time}</span>
                  <span style={{ color: e.level === "critical" ? "#fca5a5" : e.level === "error" ? "#f87171" : e.level === "muted" ? "#1e293b" : "#475569" }}>{e.msg}</span>
                </div>
              ))
            )}
          </div>

          {/* Sim buttons — below event log */}
          {videoFiles.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              {videoFiles.map((f) => {
                const active = simulatingFiles.includes(f);
                return (
                  <button key={f} onClick={() => active ? stopSimulation(f) : startSimulation(f)}
                    style={{ padding: "5px 12px", borderRadius: "var(--border-radius-md)", border: active ? "0.5px solid var(--color-border-danger)" : "0.5px solid var(--color-border-secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 500, background: active ? "var(--color-background-danger)" : "var(--color-background-secondary)", color: active ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>
                    {active ? "■" : "▶"} · {f}
                  </button>
                );
              })}
              {(() => {
                const allActive = videoFiles.every(f => simulatingFiles.includes(f));
                return (
                  <button onClick={() => allActive ? videoFiles.forEach(f => stopSimulation(f)) : videoFiles.forEach(f => { if (!simulatingFiles.includes(f)) startSimulation(f); })}
                    style={{ padding: "5px 12px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, background: "var(--color-background-tertiary)", color: "var(--color-text-secondary)" }}>
                    {allActive ? "■ Stop All" : "▶▶ All"}
                  </button>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right panel — pretty patient cards */}
        <div style={{ padding: "20px", overflowY: "auto", background: "#07070e" }}>
          <Dashboard patients={visible} onDismiss={handleDismiss} />
        </div>
      </div>
    </div>
  );
}
