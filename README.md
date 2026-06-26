# VITAL — Visual Intelligence Triage Alert Layer

AI-powered hospital triage system that monitors camera feeds in real time, detects patient distress using pose detection and vision models, and alerts clinical staff instantly via iMessage.

---

## Features

- **Dashboard (Tab 1)** — Live camera feeds with per-source YOLO/MediaPipe pose skeleton overlay. Patient cards with confidence scores, triage severity, and thumbnails. Per-tile pulsing alert highlight for CRITICAL/URGENT patients. ElevenLabs TTS audio alerts.
- **Uploads (Tab 2)** — Drag-and-drop video upload with Claude-powered frame-by-frame analysis, event timeline, searchable library, and playback.
- **Live Monitor (Tab 3)** — Overshoot RealtimeVision browser SDK streams live camera to a vision model. Current patient status updates from every inference result. Key events log with severity filtering. iMessage alerts via Photon AI / Spectrum when urgent/critical events are detected. Messaging supports replies for caregivers to receive
advice on how to deal with the situation if necessary as the response has
knowledge of the patient context/symptoms

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Styling | Tailwind CSS |
| Vision AI (live) | [Overshoot](https://overshoot.ai) RealtimeVision |
| Vision AI (frames) | Anthropic Claude (claude-haiku) |
| Pose detection | MediaPipe Pose + YOLOv8n-pose (ONNX, Web Worker) |
| TTS alerts | ElevenLabs |
| iMessage alerts | Photon AI (`@photon-ai/advanced-imessage`) via Spectrum |
| Storage | Local JSON flat-file (`data/`) |

---

## Getting Started

1. Install dependencies

2. Configure environment variables

3. Run the dev and/or deploy a production server

4. Run the iMessage alert worker (Tab 3 alerts)

---

## Architecture Notes

- **Pose detection** runs in a dedicated Web Worker per active camera/sim source (`src/app/tab1/workers/yolo.worker.ts`). MediaPipe handles 1–2 people (fast, sync); auto-escalates to YOLOv8n-pose for 3+ people.
- **Overshoot** runs entirely in the browser — no frames are sent to the Next.js server. The SDK posts structured JSON results to `/api/tab3/ingest`, which persists events and streams them to the UI over SSE.
- **Alert routing** — `src/app/lib/alertService.ts` handles ElevenLabs TTS (Tab 1) and delegates iMessage alerts to the Spectrum worker process via HTTP.
