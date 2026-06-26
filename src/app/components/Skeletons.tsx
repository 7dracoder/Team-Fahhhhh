"use client";

/**
 * Loading skeletons for the upload library card grid (Tab 4) and for
 * the analysis viewer (Tabs 2 + 4). Match the real layouts as closely as
 * possible so swapping in the real component doesn't visibly reflow.
 */

export function UploadCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading upload"
      className="flex animate-pulse flex-col gap-2 rounded-lg border border-white/10 bg-[#0c0c12] p-3"
    >
      <div className="aspect-video w-full rounded-md bg-white/5" />
      <div className="flex items-center justify-between gap-2">
        <div className="h-3.5 flex-1 rounded bg-white/5" />
        <div className="h-4 w-16 rounded-full bg-white/5" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-white/5" />
        <div className="h-3 w-24 rounded bg-white/5" />
      </div>
    </div>
  );
}

export function UploadCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <UploadCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function AnalysisViewerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading analysis"
      className="flex min-h-0 animate-pulse flex-col gap-3"
    >
      <div className="aspect-video w-full rounded-md bg-white/5" />
      <div className="h-11 w-full rounded-md bg-white/5" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-r-lg bg-white/5 px-3 py-2"
            style={{ borderLeft: "3px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-1 items-center gap-2">
                <div className="h-3 w-10 rounded bg-white/10" />
                <div className="h-3 w-24 rounded bg-white/10" />
                <div className="h-3 w-16 rounded bg-white/10" />
              </div>
              <div className="h-4 w-14 rounded-full bg-white/10" />
            </div>
            <div className="mt-2 h-3 w-3/4 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
