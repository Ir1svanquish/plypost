"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";

type VideoItem = { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: string };
type Props = { selectedId: string | null; onChange: (id: string | null) => void; onBusyChange: (busy: boolean) => void; disabled: boolean };
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;

function fileSize(bytes: number): string {
  if (bytes < 1024) return "<1 KiB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function PrivateVideoPreview({ id, name, preload = "none" }: { id: string; name?: string; preload?: "none" | "metadata" }) {
  const [details, setDetails] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return <div className="mt-3">
    <video key={id} controls playsInline preload={preload} src={`/api/videos/${encodeURIComponent(id)}?preview=1`}
      aria-label={`Preview ${name || "saved video"}`}
      onLoadedMetadata={(event) => {
        const player = event.currentTarget;
        const dimensions = player.videoWidth && player.videoHeight ? `${player.videoWidth} × ${player.videoHeight}` : "";
        const duration = Number.isFinite(player.duration) && player.duration > 0 ? `${player.duration.toFixed(1)} s` : "";
        setDetails([dimensions, duration].filter(Boolean).join(" · ") || null);
        setFailed(false);
      }}
      onError={() => { setDetails(null); setFailed(true); }}
      className="max-h-72 w-full max-w-sm rounded-lg bg-black object-contain" />
    {details && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{details}</p>}
    {failed && <p role="status" className="mt-1 text-[11px] text-[var(--warning)]">This browser cannot preview the clip. Download it to check before posting.</p>}
  </div>;
}

export function VideoAttachmentPicker({ selectedId, onChange, onBusyChange, disabled }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectId = useId();

  useEffect(() => {
    let active = true;
    fetch("/api/videos", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.videos)) throw new Error(data.error || "Could not load saved videos.");
        if (active) setVideos(data.videos);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load saved videos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function upload(file: File) {
    if (busy || disabled) return;
    setError(null);
    if (file.size > MAX_VIDEO_BYTES || file.size === 0) { setError("Choose a video up to 32 MiB."); return; }
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) { setError("Choose an MP4, WebM or MOV video."); return; }
    setBusy(true); onBusyChange(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/videos", { method: "POST", body, credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || !data.video?.id) throw new Error(data.error || "Could not save the video.");
      setVideos((current) => [data.video, ...current.filter((item) => item.id !== data.video.id)]);
      onChange(data.video.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the video.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false); onBusyChange(false);
    }
  }

  async function remove(id: string) {
    if (busy || disabled || !window.confirm("Delete this saved video from your library? Detach it from saved drafts and handoffs first.")) return;
    setError(null); setBusy(true); onBusyChange(true);
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete the video.");
      setVideos((current) => current.filter((item) => item.id !== id));
      if (selectedId === id) onChange(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the video.");
    } finally { setBusy(false); onBusyChange(false); }
  }

  const selected = videos.find((item) => item.id === selectedId);
  return <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[12px] font-bold text-[var(--text-secondary)]">Video clip · optional</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">Saved privately in Plypost. MP4, WebM or MOV · up to 32 MiB. You upload it on the platform yourself.</p></div>
      <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] ${disabled || busy ? "opacity-50" : "hover:bg-[var(--accent-soft)]"}`}><Upload size={13} aria-hidden="true" /> {busy ? "Saving…" : "Add video"}<input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={disabled || busy} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
    </div>
    {error && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">{error}</p>}
    {loading ? <p className="mt-2 text-[11px] text-[var(--text-muted)]">Loading saved videos…</p> : videos.length > 0 ? <>
      <label htmlFor={selectId} className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Attach a saved clip</label>
      <select id={selectId} value={selectedId && selected ? selectedId : ""} disabled={disabled || busy} onChange={(event) => onChange(event.target.value || null)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)]"><option value="">No video</option>{videos.map((item) => <option key={item.id} value={item.id}>{item.name} · {fileSize(item.sizeBytes)}</option>)}</select>
      {selectedId && !selected && <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">The attached clip is unavailable. Choose another clip or select No video.</p>}
      {selected && <><PrivateVideoPreview key={selected.id} id={selected.id} name={selected.name} preload="metadata" /><div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]"><a href={`/api/videos/${encodeURIComponent(selected.id)}`} download className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)]"><Download size={12} aria-hidden="true" /> Download {selected.name}</a><button type="button" disabled={disabled || busy} onClick={() => void remove(selected.id)} className="inline-flex items-center gap-1 text-[var(--danger)] disabled:opacity-50"><Trash2 size={12} aria-hidden="true" /> Delete from library</button></div></>}
    </> : <p className="mt-2 text-[11px] text-[var(--text-muted)]">No saved video clips yet.</p>}
    <p className="mt-2 text-[11px] text-[var(--text-soft)]">Library limit: 12 clips, 64 MiB total. Check the destination’s current format and size rules before posting.</p>
  </div>;
}
