"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Download, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { MAX_IMAGE_ALT_CHARS } from "@/lib/workspace";
import { MAX_POST_IMAGES } from "@/lib/media-policy";

const MAX_IMAGES = MAX_POST_IMAGES;
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
  descriptions: Readonly<Record<string, string>>;
  onChange: (ids: string[]) => void;
  onDescriptionChange: (id: string, description: string) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  context?: "draft" | "handoff";
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

function imageUrl(id: string, thumbnail = false) {
  return `/api/media/${encodeURIComponent(id)}${thumbnail ? "?thumb=1" : ""}`;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return "<1 KiB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function responseError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

/**
 * A private image library selector. Selection is controlled by its parent;
 * uploading an asset alone does not publish or attach it to saved work.
 */
export function ImageAttachmentPicker({ selectedIds, descriptions, onChange, onDescriptionChange, onBusyChange, disabled = false, readOnly = false, context = "draft" }: ImageAttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selectedIds);
  const abortRef = useRef<AbortController | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState("");
  const subject = context === "handoff" ? "handoff" : "draft";

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
        setLoadError("");
        setError("");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLibraryLoaded(false);
          setLoadError(cause instanceof Error ? cause.message : "Could not load your images.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); abortRef.current?.abort(); };
  }, [loadAttempt]);

  function retryLoad() {
    if (disabled || loading || uploading || deletingId) return;
    setLoading(true);
    setError("");
    setLoadAttempt((attempt) => attempt + 1);
  }

  function setSelection(ids: string[]) {
    selectedRef.current = ids;
    onChange(ids);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || loading || uploading || deletingId || disabled) return;
    setError("");
    const remaining = MAX_IMAGES - selectedRef.current.length;
    const picked = Array.from(files);
    if (remaining <= 0) {
      setError(`A ${subject} can use up to ${MAX_IMAGES} images. Remove one before adding another.`);
      return;
    }
    if (picked.length > remaining) {
      setError(`Only ${remaining} more ${remaining === 1 ? "image" : "images"} can be added to this ${subject}.`);
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
    if (disabled || loading || uploading || deletingId) return;
    if (selectedRef.current.includes(id)) {
      setSelection(selectedRef.current.filter((item) => item !== id));
    } else if (selectedRef.current.length < MAX_IMAGES) {
      setSelection([...selectedRef.current, id]);
    } else {
      setError(`A ${subject} can use up to ${MAX_IMAGES} images. Remove one before adding another.`);
    }
  }

  function moveImage(id: string, direction: -1 | 1) {
    if (disabled || loading || uploading || deletingId) return;
    const next = [...selectedRef.current];
    const index = next.indexOf(id);
    const other = index + direction;
    if (index < 0 || other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    setSelection(next);
  }

  async function deleteAsset(item: MediaAsset) {
    if (disabled || loading || uploading || deletingId) return;
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
  const controlsBusy = disabled || loading || uploading || deletingId !== null;
  const loadFailed = Boolean(loadError);

  return (
    <section className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5" aria-labelledby={`${inputId}-heading`} aria-busy={loading || uploading || deletingId !== null}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${inputId}-heading`} className="text-[13px] font-bold text-[var(--text)]">Images <span className="font-medium text-[var(--text-soft)]">· {selectedIds.length}/{MAX_IMAGES}</span></h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">JPEG, PNG or WebP · up to 5 MiB each. Keep up to 20 in a draft; the platform may allow fewer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={controlsBusy || selectedIds.length >= MAX_IMAGES} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={controlsBusy || selectedIds.length >= MAX_IMAGES} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50">
            {uploading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            {uploading ? "Uploading…" : "Add images"}
          </button>
          <button type="button" onClick={() => setLibraryOpen((open) => !open)} aria-expanded={libraryOpen} aria-controls={`${inputId}-library`} className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)]">{libraryOpen ? "Hide library" : "Choose from library"}</button>
        </div>
      </div>

      {loadFailed && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--warning)]"><span>{loadError} Your saved image list may be incomplete.</span><button type="button" onClick={retryLoad} disabled={controlsBusy} className="font-semibold underline underline-offset-2 disabled:opacity-50">Retry library</button></div>}
      {error && <div role="alert" className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">{error}</div>}
      {missingCount > 0 && libraryLoaded && !loading && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[var(--warning)]"><p role="status">{missingCount} saved {missingCount === 1 ? "image is" : "images are"} unavailable.</p><button type="button" onClick={() => setSelection(selected.map((item) => item.id))} disabled={controlsBusy} className="font-semibold underline underline-offset-2 disabled:opacity-50">Remove unavailable</button></div>}
      {selected.length > 0 && <ul className="mt-4 grid max-h-[430px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="Selected images">{selected.map((item, index) => <li key={item.id} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="flex min-w-0 gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--field)]"><Image unoptimized src={imageUrl(item.id, true)} alt={descriptions[item.id] || item.name} fill sizes="80px" className="object-cover" /></div>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <span className="truncate text-[11px] font-medium text-[var(--text-secondary)]" title={item.name}>{index + 1}. {item.name}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => moveImage(item.id, -1)} disabled={controlsBusy || index === 0} aria-label={`Move image ${index + 1} earlier`} title="Move earlier" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ArrowUp size={15} aria-hidden="true" /></button>
              <button type="button" onClick={() => moveImage(item.id, 1)} disabled={controlsBusy || index === selectedIds.length - 1} aria-label={`Move image ${index + 1} later`} title="Move later" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ArrowDown size={15} aria-hidden="true" /></button>
              <button type="button" onClick={() => toggleImage(item.id)} disabled={controlsBusy} aria-label={`Remove ${item.name} from ${subject}`} title={`Remove from ${subject}`} className="ml-auto rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"><X size={15} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
        <label htmlFor={`${inputId}-${item.id}-alt`} className="mt-3 block text-[11px] font-semibold text-[var(--text-secondary)]">Image description <span className="font-normal text-[var(--text-soft)]">(optional)</span></label>
        <input id={`${inputId}-${item.id}-alt`} type="text" value={descriptions[item.id] ?? ""} onChange={(event) => onDescriptionChange(item.id, Array.from(event.target.value).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join(""))} disabled={controlsBusy && !readOnly} readOnly={readOnly} maxLength={MAX_IMAGE_ALT_CHARS} placeholder="Describe what this image shows" className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-2.5 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent-border)] disabled:opacity-50" />
      </li>)}</ul>}
      {selectedIds.length === 0 && !loading && <p className="mt-3 text-[12px] text-[var(--text-soft)]">No images selected for this {subject}.</p>}

      <div id={`${inputId}-library`} hidden={!libraryOpen} className="mt-4 border-t border-[var(--line)] pt-4">
        {libraryOpen && <>
        <p className="mb-3 text-[12px] font-semibold text-[var(--text-secondary)]">Your image library</p>
        {loading ? <p role="status" className="text-[12px] text-[var(--text-muted)]">Loading images…</p> : loadFailed && media.length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">The library could not be checked. Retry above.</p> : media.length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">No images uploaded yet.</p> : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Image library">{media.map((item) => {
          const attached = selectedIds.includes(item.id);
          return <li key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            <div className="relative aspect-square overflow-hidden bg-[var(--field)]"><Image unoptimized src={imageUrl(item.id, true)} alt={item.name} fill sizes="(max-width: 640px) 50vw, 160px" className="object-cover" /></div>
            <div className="p-2"><p className="truncate text-[11px] font-medium text-[var(--text-secondary)]" title={item.name}>{item.name}</p><p className="mt-0.5 text-[10px] text-[var(--text-soft)]">{fileSize(item.sizeBytes)} · {item.width} × {item.height}</p>
              <div className="mt-2 flex items-center justify-between gap-1"><button type="button" onClick={() => toggleImage(item.id)} disabled={controlsBusy || (!attached && selectedIds.length >= MAX_IMAGES)} aria-pressed={attached} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50">{attached ? <Check size={12} aria-hidden="true" /> : <ImagePlus size={12} aria-hidden="true" />}{attached ? "Added" : "Use"}</button><div className="flex items-center gap-0.5"><a href={`${imageUrl(item.id)}?download=1`} download={item.name} title={`Download ${item.name}`} aria-label={`Download ${item.name}`} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><Download size={14} aria-hidden="true" /></a>{context === "draft" && <button type="button" onClick={() => { void deleteAsset(item); }} disabled={controlsBusy} title={`Delete ${item.name} from library`} aria-label={`Delete ${item.name} from library`} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50">{deletingId === item.id ? <LoaderCircle size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}</button>}</div></div>
            </div>
          </li>;
        })}</ul>}
        </>}
      </div>
      <p className="mt-4 text-[11px] leading-5 text-[var(--text-soft)]">{context === "handoff" ? "Save to attach this image order and its descriptions to the handoff." : "Image order and descriptions stay with this draft."} When publishing yourself, download the images and add their descriptions on the platform. Removing an image keeps it in your private library.</p>
    </section>
  );
}
