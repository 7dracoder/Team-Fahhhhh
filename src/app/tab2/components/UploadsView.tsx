"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import type { Upload, UploadStatus } from "@/app/lib/types";
import StatusBadge from "@/app/components/StatusBadge";
import { fetchWithToast } from "@/app/lib/fetchWithToast";
import { toast } from "@/app/lib/ui/useToast";
import AnalysisViewer from "./AnalysisViewer";

const MAX_BYTES = 500 * 1024 * 1024;

interface UploadRow extends Upload {
  eventCount: number;
}

interface PendingUpload {
  tempId: string;
  filename: string;
  size: number;
  progress: number;
  status: "uploading" | "failed";
  error?: string;
}

interface AnalysisProgress {
  percent: number;
  message: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

export default function UploadsView() {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [pending, setPending] = useState<Record<string, PendingUpload>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progressById, setProgressById] = useState<Record<string, AnalysisProgress>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tab2/uploads", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load uploads");
      setUploads(data.uploads ?? []);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId === null && uploads.length > 0) {
      setSelectedId(uploads[0].id);
    }
  }, [uploads, selectedId]);

  const selectedStatus = useMemo(
    () => uploads.find((u) => u.id === selectedId)?.status,
    [uploads, selectedId],
  );

  useEffect(() => {
    if (!selectedId) return;
    if (selectedStatus !== "queued" && selectedStatus !== "analyzing") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/tab2/uploads/${selectedId}/progress`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data: { status: UploadStatus; percent: number; message: string } = await res.json();

        setProgressById((prev) => ({
          ...prev,
          [selectedId]: { percent: data.percent, message: data.message },
        }));
        setUploads((prev) =>
          prev.map((u) => (u.id === selectedId ? { ...u, status: data.status } : u)),
        );

        if (data.status === "done") {
          const detailRes = await fetch(`/api/tab2/uploads/${selectedId}`, { cache: "no-store" });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            console.log(`[tab2] analysis complete for ${selectedId}`, detail);
          }
          refresh();
        } else if (data.status === "failed") {
          refresh();
        }
      } catch {
        /* transient network errors are fine; next tick will retry */
      }
    };

    poll();
    const intervalId = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedId, selectedStatus, refresh]);

  const startUpload = useCallback(
    (file: File) => {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPending((prev) => ({
        ...prev,
        [tempId]: {
          tempId,
          filename: file.name,
          size: file.size,
          progress: 0,
          status: "uploading",
        },
      }));

      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (!e.lengthComputable) return;
        const progress = e.loaded / e.total;
        setPending((prev) =>
          prev[tempId] ? { ...prev, [tempId]: { ...prev[tempId], progress } } : prev,
        );
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPending((prev) => {
            const next = { ...prev };
            delete next[tempId];
            return next;
          });
          refresh();
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.uploadId) setSelectedId(body.uploadId);
          } catch {
            /* no-op */
          }
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.error) msg = body.error;
          } catch {
            /* no-op */
          }
          setPending((prev) =>
            prev[tempId]
              ? { ...prev, [tempId]: { ...prev[tempId], status: "failed", error: msg } }
              : prev,
          );
          toast(msg, "error");
        }
      });

      xhr.addEventListener("error", () => {
        setPending((prev) =>
          prev[tempId]
            ? {
                ...prev,
                [tempId]: { ...prev[tempId], status: "failed", error: "Network error" },
              }
            : prev,
        );
        toast("Upload failed: network error", "error");
      });

      xhr.open("POST", "/api/tab2/uploads");
      xhr.send(form);
    },
    [refresh],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      for (const r of rejected) {
        const code = r.errors[0]?.code ?? "rejected";
        const tempId = `rejected-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setPending((prev) => ({
          ...prev,
          [tempId]: {
            tempId,
            filename: r.file.name,
            size: r.file.size,
            progress: 0,
            status: "failed",
            error: code === "file-too-large" ? "File exceeds 500MB" : r.errors[0]?.message ?? code,
          },
        }));
      }
      for (const file of accepted) startUpload(file);
    },
    [startUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "video/*": [] },
    maxSize: MAX_BYTES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  const dismissPending = useCallback((tempId: string) => {
    setPending((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this upload? This cannot be undone.")) return;
      try {
        const res = await fetchWithToast(
          `/api/tab2/uploads/${id}`,
          { method: "DELETE" },
          { errorMessage: "Delete failed" },
        );
        if (!res.ok) return;
        if (selectedId === id) setSelectedId(null);
        refresh();
      } catch {
        /* fetchWithToast already showed the toast */
      }
    },
    [refresh, selectedId],
  );

  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return uploads;
    return uploads.filter((u) => u.filename.toLowerCase().includes(q));
  }, [uploads, searchQuery]);

  const [seeding, setSeeding] = useState(false);
  const handleLoadSample = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetchWithToast(
        "/api/tab2/demo/seed",
        { method: "POST" },
        { errorMessage: "Could not load sample" },
      );
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      await refresh();
      if (body.uploadId) setSelectedId(body.uploadId);
    } catch {
      /* fetchWithToast already showed the toast */
    } finally {
      setSeeding(false);
    }
  }, [refresh, seeding]);

  const selected = useMemo(
    () => uploads.find((u) => u.id === selectedId) ?? null,
    [uploads, selectedId],
  );

  const pendingList = Object.values(pending).sort((a, b) => a.tempId.localeCompare(b.tempId));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#09090f] text-[15px] text-slate-200 lg:flex-row">
      <section className="flex w-full flex-col gap-4 border-b border-white/10 p-6 lg:w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div>
          <h1 className="text-lg font-semibold text-white">Uploads</h1>
          <p className="mt-1 text-xs text-slate-400">
            Drop videos to store and play back. Analysis comes later.
          </p>
        </div>

        <div
          {...getRootProps({
            className: `flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition-colors ${
              isDragActive
                ? "border-blue-400/60 bg-blue-500/5"
                : "border-white/15 bg-[#0c0c12] hover:border-white/25"
            }`,
          })}
        >
          <input {...getInputProps()} />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-slate-500">
            <path
              d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-sm text-slate-300">
            {isDragActive ? "Drop to upload" : "Drag & drop video files here"}
          </div>
          <div className="text-xs text-slate-500">video/* up to 500MB</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={open}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
            >
              Choose files
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLoadSample();
              }}
              disabled={seeding}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {seeding ? "Loading…" : "Load sample"}
            </button>
          </div>
        </div>

        {pendingList.length > 0 && (
          <div className="flex flex-col gap-2">
            {pendingList.map((p) => (
              <div
                key={p.tempId}
                className="rounded-lg border border-white/10 bg-[#0c0c12] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{p.filename}</div>
                    <div className="text-[10px] text-slate-500">{formatBytes(p.size)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    <button
                      onClick={() => dismissPending(p.tempId)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {p.status === "uploading" && (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded bg-white/5">
                    <div
                      className="h-full bg-blue-400 transition-all"
                      style={{ width: `${Math.round(p.progress * 100)}%` }}
                    />
                  </div>
                )}
                {p.status === "failed" && p.error && (
                  <div className="mt-1.5 text-[11px] text-red-300">{p.error}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Library
          </div>
          <button
            onClick={refresh}
            className="text-[11px] text-slate-400 hover:text-slate-200"
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filenames…"
            className="w-full rounded-md border border-white/10 bg-[#0c0c12] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-white/25 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-slate-500 hover:text-slate-300"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
          {loading ? (
            <div className="text-xs text-slate-500">Loading…</div>
          ) : listError ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {listError}
            </div>
          ) : uploads.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-6 text-center text-xs text-slate-500">
              No uploads yet.
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-6 text-center text-xs text-slate-500">
              No uploads match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filtered.map((u) => {
              const active = selectedId === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className={`group flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-white/25 bg-white/10"
                      : "border-white/10 bg-[#0c0c12] hover:border-white/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-white">{u.filename}</div>
                    <StatusBadge status={u.status} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{formatRelative(u.createdAt)}</span>
                    <span>
                      {u.eventCount} event{u.eventCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col p-6">
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-white">
                  {selected.filename}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                  <StatusBadge status={selected.status} />
                  <span>{formatRelative(selected.createdAt)}</span>
                  <span className="font-mono text-slate-600">{selected.id.slice(0, 8)}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(selected.id)}
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
              >
                Delete
              </button>
            </div>

            <AnalysisViewer
              key={selected.id}
              uploadId={selected.id}
              status={selected.status}
            />

            {(selected.status === "queued" || selected.status === "analyzing") && (
              <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">
                    {progressById[selected.id]?.message ||
                      (selected.status === "queued" ? "Queued" : "Analyzing…")}
                  </span>
                  <span className="font-mono text-slate-500">
                    {progressById[selected.id]?.percent ?? 0}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-white/5">
                  <div
                    className="h-full bg-blue-400 transition-all duration-300"
                    style={{ width: `${progressById[selected.id]?.percent ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {selected.status === "failed" && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <div className="font-medium">Analysis failed</div>
                {selected.error && <div className="mt-1 text-red-300/80">{selected.error}</div>}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-600">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect
                x="2"
                y="9"
                width="30"
                height="26"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M32 16l10-6v24l-10-6V16z" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="17" cy="22" r="6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="text-sm">Select an upload to play it back.</span>
            <span className="text-xs">Or drop a video on the left to get started.</span>
          </div>
        )}
      </section>
    </div>
  );
}
