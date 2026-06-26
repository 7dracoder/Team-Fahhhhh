"use client";

import { useImperativeHandle, useRef, type Ref } from "react";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  togglePlay: () => void;
  seekRelative: (deltaSeconds: number) => void;
  isPaused: () => boolean;
}

interface Props {
  ref?: Ref<VideoPlayerHandle>;
  src: string;
  onTimeChange: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}

export default function VideoPlayer({ ref, src, onTimeChange, onDurationChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number) {
        const v = videoRef.current;
        if (!v) return;
        const max = Number.isFinite(v.duration) ? v.duration : seconds;
        v.currentTime = Math.max(0, Math.min(max, seconds));
      },
      togglePlay() {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      },
      seekRelative(delta: number) {
        const v = videoRef.current;
        if (!v) return;
        const max = Number.isFinite(v.duration) ? v.duration : v.currentTime + delta;
        v.currentTime = Math.max(0, Math.min(max, v.currentTime + delta));
      },
      isPaused() {
        return videoRef.current?.paused ?? true;
      },
    }),
    [],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        className="aspect-video w-full"
        src={src}
        onTimeUpdate={(e) => onTimeChange(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) onDurationChange?.(d);
        }}
      />
    </div>
  );
}
