"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";

const MAX_IMAGES = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type MediaAsset = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  url: string;
};

type ImageAttachmentPickerProps = {
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
};

function isMediaAsset(value: unknown): value is MediaAsset {
  if (!value || typeof value !== "object") return false;
  const media = value as Partial<MediaAsset>;
  return typeof media.id === "string" && media.id.length > 0 &&
    typeof media.name === "string" &&
    ALLOWED_TYPES.has(media.mimeType || "") &&
    typeof media.sizeBytes === "number" && Number.isFinite(media.sizeBytes) &&
    typeof media.width === "number" && media.width > 0 &&
    typeof media.height === "number" && media.height > 0 &&
    typeof media.url === "string";
}

function imageUrl(id: string) {
  return `/api/media/${encodeURIComponent(id)}`;
}

function fileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function responseError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

/**
 * A private image library selector. Selection is controlled by the draft editor;
 * uploading an asset alone does not publish it or attach it to a saved draft.
 */
export function ImageAttachmentPicker({ selectedIds, onChange, onBusyChange, disabled = false }: ImageAttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selectedIds);
  const abortRef = useRef<AbortController | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");

  selectedRef.current = selectedIds;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/media", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load your images."));
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("media" in payload) || !Array.isArray(payload.media)) {
          throw new Error("Could not read your image library.");
        }
        setMedia(payload.media.filter(isMediaAsset));
        setLibraryLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your images.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); abortRef.current?.abort(); };
  }, []);

  function setSelection(ids: string[]) {
    selectedRef.current = ids;
    onChange(ids);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || uploading || deletingId || disabled) return;
    setError("");
    const remaining = MAX_IMAGES - selectedRef.current.length;
    const picked = Array.from(files);
    if (remaining <= 0) {
      setError("A draft can use up to four images. Remove one before adding another.");
      return;
    }
    if (picked.length > remaining) {
      setError(`Only ${remaining} more ${remaining === 1 ? "image" : "images"} can be added to this draft.`);
      return;
    }
    for (const file of picked) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError(`${file.name}: choose a JPEG, PNG or WebP image.`);
        return;
      }
      if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        setError(`${file.name}: each image must be at most 5 MB and cannot be empty.`);
        return;
      }
    }

    setUploading(true);
    onBusyChange(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for (const file of picked) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/media", {
          method: "POST", body, cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseError(response, `Could not upload ${file.name}.`));
        const payload: unknown = await response.json();
        const asset = payload && typeof payload === "object" && "media" in payload ? payload.media : null;
        if (!isMediaAsset(asset)) throw new Error(`Could not read the uploaded image ${file.name}.`);
        setMedia((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        const next = [...selectedRef.current.filter((id) => id !== asset.id), asset.id].slice(0, MAX_IMAGES);
        setSelection(next);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Image upload failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUploading(false);
      onBusyChange(false);
    }
  }

  function toggleImage(id: string) {
    if (disabled || uploading || deletingId) return;
    if (selectedRef.current.includes(id)) {
      setSelection(selectedRef.current.filter((item) => item !== id));
    } else if (selectedRef.current.length < MAX_IMAGES) {
      setSelection([...selectedRef.current, id]);
    } else {
      setError("A draft can use up to four images. Remove one before adding another.");
    }
  }

  async function deleteAsset(item: MediaAsset) {
    if (disabled || uploading || deletingId) return;
    if (!window.confirm(`Permanently delete ${item.name} from your image library? First remove it from any saved drafts and save those changes. This cannot be undone.`)) return;
    setError("");
    setDeletingId(item.id);
    onBusyChange(true);
    try {
      const response = await fetch(imageUrl(item.id), { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, `Could not delete ${item.name}.`));
      setMedia((current) => current.filter((asset) => asset.id !== item.id));
      if (selectedRef.current.includes(item.id)) setSelection(selectedRef.current.filter((id) => id !== item.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the image.");
    } finally {
      setDeletingId(null);
      onBusyChange(false);
    }
  }

  const selected = selectedIds.map((id) => media.find((item) => item.id === id)).filter((item): item is MediaAsset => Boolean(item));
  const missingCount = selectedIds.length - selected.length;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5" aria-labelledby={`${inputId}-heading`} aria-busy={loading || uploading || deletingId !== null}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${inputId}-heading`} className="text-[13px] font-bold text-[var(--text)]">Images <span className="font-medium text-[var(--text-soft)]">· {selectedIds.length}/{MAX_IMAGES}</span></h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">JPEG, PNG or WebP · up to 5 MB each. Images are kept privately in Plypost.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={disabled || uploading || deletingId !== null || selectedIds.length >= MAX_IMAGES} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading || deletingId !== null || selectedIds.length >= MAX_IMAGES} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50">
            {uploading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            {uploading ? "Uploading…" : "Add images"}
          </button>
          <button type="button" onClick={() => setLibraryOpen((open) => !open)} aria-expanded={libraryOpen} aria-controls={`${inputId}-library`} className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">{libraryOpen ? "Hide library" : "Choose from library"}</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</p>}
      {missingCount > 0 && libraryLoaded && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--warning)]"><p role="status">{missingCount} saved {missingCount === 1 ? "image is" : "images are"} unavailable.</p><button type="button" onClick={() => setSelection(selected.map((item) => item.id))} disabled={disabled || uploading || deletingId !== null} className="font-semibold underline underline-offset-2 disabled:opacity-50">Remove unavailable</button></div>}
      {selected.length > 0 && <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Selected images">{selected.map((item) => <li key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="relative aspect-square overflow-hidden bg-[var(--field)]"><Image unoptimized src={imageUrl(item.id)} alt={item.name} fill sizes="(max-width: 640px) 50vw, 160px" className="object-cover" /></div>
        <div className="flex min-w-0 items-center gap-1 p-2"><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-secondary)]" title={item.name}>{item.name}</span><button type="button" onClick={() => toggleImage(item.id)} disabled={disabled || uploading || deletingId !== null} aria-label={`Remove ${item.name} from draft`} title="Remove from draft" className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"><X size={14} aria-hidden="true" /></button></div>
      </li>)}</ul>}
      {selectedIds.length === 0 && !loading && <p className="mt-3 text-[12px] text-[var(--text-soft)]">No images selected for this draft.</p>}

      <div id={`${inputId}-library`} hidden={!libraryOpen} className="mt-4 border-t border-[var(--line)] pt-4">
        {libraryOpen && <>
        <p className="mb-3 text-[12px] font-semibold text-[var(--text-secondary)]">Your image library</p>
        {loading ? <p role="status" className="text-[12px] text-[var(--text-muted)]">Loading images…</p> : media.length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">No images uploaded yet.</p> : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Image library">{media.map((item) => {
          const attached = selectedIds.includes(item.id);
          return <li key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            <div className="relative aspect-square overflow-hidden bg-[var(--field)]"><Image unoptimized src={imageUrl(item.id)} alt={item.name} fill sizes="(max-width: 640px) 50vw, 160px" className="object-cover" /></div>
            <div className="p-2"><p className="truncate text-[11px] font-medium text-[var(--text-secondary)]" title={item.name}>{item.name}</p><p className="mt-0.5 text-[10px] text-[var(--text-soft)]">{fileSize(item.sizeBytes)} · {item.width} × {item.height}</p>
              <div className="mt-2 flex items-center justify-between gap-1"><button type="button" onClick={() => toggleImage(item.id)} disabled={disabled || uploading || deletingId !== null || (!attached && selectedIds.length >= MAX_IMAGES)} aria-pressed={attached} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50">{attached ? <Check size={12} aria-hidden="true" /> : <ImagePlus size={12} aria-hidden="true" />}{attached ? "Added" : "Use"}</button><div className="flex items-center gap-0.5"><a href={imageUrl(item.id)} download={item.name} title={`Download ${item.name}`} aria-label={`Download ${item.name}`} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><Download size={14} aria-hidden="true" /></a><button type="button" onClick={() => { void deleteAsset(item); }} disabled={disabled || uploading || deletingId !== null} title={`Delete ${item.name} from library`} aria-label={`Delete ${item.name} from library`} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50">{deletingId === item.id ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}</button></div></div>
            </div>
          </li>;
        })}</ul>}
        </>}
      </div>
      <p className="mt-4 text-[11px] leading-5 text-[var(--text-soft)]">Removing an image from this draft keeps it in your private library. Assisted publishing still requires you to add images on the destination platform; scheduled publishing here is a simulation.</p>
    </section>
  );
}
