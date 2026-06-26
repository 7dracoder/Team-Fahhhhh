"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisEvent, Upload, UploadStatus } from "@/app/lib/types";
import { AnalysisViewerSkeleton } from "@/app/components/Skeletons";
import SeverityFilterChips, {
  type SeverityFilter,
} from "@/app/components/SeverityFilterChips";
import VideoPlayer, { type VideoPlayerHandle } from "./VideoPlayer";
import EventTimeline from "./EventTimeline";
import EventLogs from "./EventLogs";

interface Props {
  uploadId: string;
  status?: UploadStatus;
}

interface Detail {
  upload: Upload;
  events: AnalysisEvent[];
}

export default function AnalysisViewer({ uploadId, status }: Props) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCurrentTime(0);
    fetch(`/api/tab2/uploads/${uploadId}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError(body.error || "Failed to load");
          setData(null);
        } else {
          setData(body);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [uploadId, status]);

  const sortedEvents = useMemo(() => {
    if (!data) return [];
    return [...data.events].sort((a, b) => a.startTs - b.startTs);
  }, [data]);

  const severityCounts = useMemo(() => {
    const counts: Partial<Record<SeverityFilter, number>> = { all: sortedEvents.length };
    for (const e of sortedEvents) {
      counts[e.severity] = (counts[e.severity] ?? 0) + 1;
    }
    return counts;
  }, [sortedEvents]);

  const filteredEvents = useMemo(() => {
    if (severityFilter === "all") return sortedEvents;
    return sortedEvents.filter((e) => e.severity === severityFilter);
  }, [sortedEvents, severityFilter]);

  const duration = useMemo(() => {
    if (data?.upload.durationSeconds && data.upload.durationSeconds > 0) {
      return data.upload.durationSeconds;
    }
    if (videoDuration > 0) return videoDuration;
    if (sortedEvents.length > 0) return Math.max(...sortedEvents.map((e) => e.endTs));
    return 0;
  }, [data, videoDuration, sortedEvents]);

  const activeEvent = useMemo<AnalysisEvent | null>(() => {
    let best: AnalysisEvent | null = null;
    for (const e of sortedEvents) {
      if (currentTime >= e.startTs && currentTime <= e.endTs) {
        if (!best || e.startTs > best.startTs) best = e;
      }
    }
    return best;
  }, [sortedEvents, currentTime]);

  const handleSeek = useCallback((t: number) => {
    playerRef.current?.seekTo(t);
    setCurrentTime(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      switch (e.key) {
        case " ":
        case "Spacebar":
          e.preventDefault();
          playerRef.current?.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          playerRef.current?.seekRelative(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          playerRef.current?.seekRelative(5);
          break;
        case "ArrowDown": {
          if (sortedEvents.length === 0) return;
          e.preventDefault();
          const next = sortedEvents.find((ev) => ev.startTs > currentTime + 0.05);
          if (next) handleSeek(next.startTs);
          break;
        }
        case "ArrowUp": {
          if (sortedEvents.length === 0) return;
          e.preventDefault();
          const prev = [...sortedEvents]
            .reverse()
            .find((ev) => ev.startTs < currentTime - 0.05);
          if (prev) handleSeek(prev.startTs);
          break;
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sortedEvents, currentTime, handleSeek]);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
        {error}
      </div>
    );
  }
  if (!data) {
    return <AnalysisViewerSkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <VideoPlayer
        ref={playerRef}
        src={`/api/tab2/uploads/${uploadId}/video`}
        onTimeChange={setCurrentTime}
        onDurationChange={setVideoDuration}
      />
      <EventTimeline
        events={sortedEvents}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Events ({filteredEvents.length}
            {filteredEvents.length !== sortedEvents.length
              ? ` of ${sortedEvents.length}`
              : ""}
            )
          </div>
          <div className="text-[10px] text-slate-600">
            space · ←/→ 5s · ↑/↓ prev/next
          </div>
        </div>
        <div className="mb-2">
          <SeverityFilterChips
            value={severityFilter}
            onChange={setSeverityFilter}
            counts={severityCounts}
          />
        </div>
        <div className="-mr-2 max-h-[50vh] overflow-y-auto pr-2">
          <EventLogs
            events={filteredEvents}
            activeEventId={activeEvent?.id ?? null}
            onSelect={(evt) => handleSeek(evt.startTs)}
          />
        </div>
      </div>
    </div>
  );
}
