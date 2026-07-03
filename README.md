# SafeSight

AI-powered hospital monitoring that watches camera feeds in real time, detects patient distress using pose detection and vision models, and alerts clinical staff via TTS and iMessage.

---

## Features

- **Dashboard (Tab 1)** — Live camera and simulation feeds with per-source YOLO/MediaPipe pose skeleton overlay. Patient cards with confidence scores, triage severity, and thumbnails. Per-tile pulsing alert highlight for CRITICAL/URGENT patients. ElevenLabs TTS audio alerts on CRITICAL detections.
- **Library (Tab 2)** — Drag-and-drop video upload with frame-by-frame analysis, event timeline, searchable library, and playback.
- **Direct Feed (Tab 3)** — Browser captures live camera frames and sends them to a vision model every few seconds. Current patient status updates from every inference result. Key events log with severity filtering, an on-demand nurse shift-handoff summary, and iMessage alerts when urgent/critical events are detected. Messaging supports replies so caregivers receive triage-style advice, informed by patient context and symptoms.
- **Quality Report (Tab 4)** — Weekly incident report for a healthcare quality/safety professional. Aggregates all incidents across live sessions and uploads into stats, trends, and actionable recommendations.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime / package manager | Bun |
| Styling | Tailwind CSS |
| Vision triage (all feeds) | [Baseten](https://baseten.co) — **Gemma 3 27B IT** (VLM), with Anthropic Claude fallback |
| Clinical reasoning | [Baseten](https://baseten.co) — **GPT OSS 120B** (nurse replies, shift-handoff notes, weekly report), with Claude fallback |
| Pose detection | MediaPipe Pose + YOLOv8n-pose (ONNX, Web Worker) |
| TTS alerts | ElevenLabs |
| iMessage alerts | Spectrum (`spectrum-ts`) + Photon local iMessage provider |
| Storage | Local JSON flat-file (`storage/`) |

> Anthropic Claude is configured as an **automatic fallback** for both vision triage and text reasoning — if a Baseten call fails or is unconfigured, the app transparently falls back to Claude.

---

## Getting Started

1. Install dependencies

   ```bash
   bun install
   ```

2. Configure environment variables

   Copy `.env.example` to `.env.local` and fill in your keys.

   ```bash
   cp .env.example .env.local
   ```

3. (Optional) Verify the environment

   ```bash
   bun run doctor
   ```

   Checks API keys, `ffmpeg`/`ffprobe` on PATH, sample files, and storage directories.

4. Run the dev server

   ```bash
   bun run dev
   ```

   App runs at http://localhost:3000.

5. Run the iMessage alert worker (Direct Feed alerts)

   In a separate terminal:

   ```bash
   bun run spectrum-worker
   ```

   Requires macOS with iMessage signed in and **Full Disk Access** granted to your terminal app (so it can read `~/Library/Messages/chat.db`). See the iMessage notes below.

---

## Models & Baseten

Two dedicated Baseten deployments power the AI, both exposing the OpenAI-compatible
`/chat/completions` schema:

- **Gemma 3 27B IT** (vision-language) — triages every camera frame across Tab 1, Tab 2,
  and Tab 3: posture, movement, distress, event type, severity, and confidence.
- **GPT OSS 120B** (text) — caregiver reply suggestions, the Tab 3 shift-handoff summary,
  and the Tab 4 weekly quality report.

Each deployment has its own URL, API key, and model slug (see `.env.example`). The shared
client lives in `src/app/lib/baseten.ts` and fails fast (request timeout) so a cold or
unreachable deployment falls back to Claude instead of hanging.

> **Baseten billing is per-minute of GPU uptime, not per token.** Enable scale-to-zero on
> idle, and note that a cold deployment can take several minutes to wake — pre-warm before
> a demo.

---

## Architecture Notes

- **Pose detection** runs in a dedicated Web Worker per active camera/sim source
  (`src/app/tab1/workers/yolo.worker.ts`). MediaPipe handles 1–2 people (fast, sync) and
  auto-escalates to YOLOv8n-pose for 3+ people.
- **Live vision (Tab 3)** runs in the browser: `LiveFeed` captures a downscaled JPEG frame
  from the camera every `NEXT_PUBLIC_LIVE_FRAME_INTERVAL_MS` (default 4s) and POSTs it to
  `/api/tab3/analyze`. That route runs Baseten Gemma, persists concerning events, and
  streams them to the UI over SSE. "Normal" observations update the live status panel but
  are not persisted.
- **Alert routing** — `src/app/lib/alertService.ts` handles ElevenLabs TTS (Tab 1) and
  delegates iMessage alerts to the Spectrum worker process over HTTP. Alerts are mocked by
  default (`MOCK_ALERTS=true`) to protect credits; set `MOCK_ALERTS=false` to send for real.
- **iMessage (local mode)** — the Spectrum worker (`src/scripts/spectrum-alert-worker.ts`)
  runs under **bun** (the Photon package ships bun/ESM export conditions). In local mode it
  sends the initial alert directly through the local iMessage SDK (Spectrum local mode only
  supports replying to existing threads), then handles inbound replies and answers them with
  GPT OSS 120B (2 follow-ups per alert).
- **Storage** — uploads, events, sessions, and alert threads persist to JSON flat-files
  under `storage/`.

---

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the Next.js dev server |
| `bun run build` | Production build |
| `bun run start` | Start the production server |
| `bun run lint` | Lint |
| `bun run doctor` | Environment readiness check |
| `bun run spectrum-worker` | Start the iMessage alert worker |

---

## iMessage Alerts (macOS, local mode)

1. In `.env.local`: `PHOTON_IMESSAGE_LOCAL=true`, `MOCK_ALERTS=false`, and set
   `NURSE_PHONE` (E.164, e.g. `+15551234567`) to the number that receives alerts and can reply.
2. Grant **Full Disk Access** to the terminal app you launch the worker from
   (System Settings → Privacy & Security → Full Disk Access), then fully quit and reopen it.
3. `bun run spectrum-worker` — it listens on `http://127.0.0.1:39847`.
4. Health check: `curl http://127.0.0.1:39847/health` → `{"ok":true}`.

Cloud mode (Photon project credentials) is also supported — set `PHOTON_PROJECT_ID` and
`PHOTON_PROJECT_SECRET` and leave `PHOTON_IMESSAGE_LOCAL=false`.
