"use client";

import { useRef } from "react";
import { Clock3, Download, LogOut, Upload, UserRound } from "lucide-react";
import { platforms, type PlatformId } from "@/lib/platforms";
import { MastodonConnectionPanel, type MastodonConnection } from "@/components/mastodon-live-panel";

type AuditEntry = { action: string; subject_id: string | null; detail: string | null; created_at: string };
type SimulationReceipt = { platform: PlatformId; id: string; status: "simulated"; publishedAt: string; content: string };

type Props = {
  email: string;
  auditLog: AuditEntry[];
  activity: SimulationReceipt[];
  onClearActivity: () => void;
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string;
  mastodonConnection: MastodonConnection | null;
  mastodonLoading: boolean;
  mastodonError: string | null;
  onRefreshMastodon: () => Promise<void>;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onFullExport: () => Promise<void>;
  onFullImport: (file: File) => Promise<void>;
  backupBusy: boolean;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function AccountPanel({ email, auditLog, activity, onClearActivity, onLogout, logoutBusy, logoutError, mastodonConnection, mastodonLoading, mastodonError, onRefreshMastodon, onExport, onImport, onFullExport, onFullImport, backupBusy }: Props) {
  const fullInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  return <div id="account" className="section-anchor space-y-6">
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">Account</p>
      <h1 className="text-[29px] font-bold tracking-[-0.045em] text-[var(--text)] sm:text-[34px]">Your workspace</h1>
      <p className="mt-1 text-[14px] text-[var(--text-muted)]">Account details and activity stay here, outside your writing space.</p>
    </div>
    <section className="panel-border soft-shadow flex flex-wrap items-center justify-between gap-4 rounded-[18px] bg-[var(--surface)] p-6 sm:p-7" aria-label="Signed-in account">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><UserRound size={20} /></span><div className="min-w-0"><p className="text-[12px] text-[var(--text-muted)]">Signed in as</p><p className="truncate text-[14px] font-bold text-[var(--text)]">{email}</p></div></div>
      <button type="button" onClick={() => { void onLogout(); }} disabled={logoutBusy} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"><LogOut size={15} /> {logoutBusy ? "Checking sign-out…" : "Sign out"}</button>
    </section>
    {logoutError && <p role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[12px] text-[var(--danger)]">{logoutError}</p>}
    <MastodonConnectionPanel connection={mastodonConnection} loading={mastodonLoading} loadError={mastodonError} onRefresh={onRefreshMastodon} />
    <details className="panel-border soft-shadow rounded-[18px] bg-[var(--surface)]" aria-label="Backup and restore">
      <summary className="cursor-pointer px-6 py-5 text-[17px] font-bold sm:px-7">Backup and restore</summary>
      <div className="space-y-4 border-t border-[var(--line)] px-6 py-5 sm:px-7">
        <p className="text-[13px] leading-6 text-[var(--text-muted)]">Saved drafts, plans, and media live in this account&apos;s server storage. Download a private copy before moving to another installation.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void onFullExport()} disabled={backupBusy} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50"><Download size={15} /> {backupBusy ? "Working…" : "Download full backup"}</button>
          <button type="button" onClick={() => fullInput.current?.click()} disabled={backupBusy} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft)] disabled:opacity-50"><Upload size={15} /> Restore full backup</button>
          <input ref={fullInput} type="file" accept="application/json,.json" className="sr-only" disabled={backupBusy} aria-label="Choose a full Plypost backup to restore" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFullImport(file); event.target.value = ""; }} />
        </div>
        <p className="text-[12px] leading-5 text-[var(--text-soft)]">A full backup includes saved images and videos. Restoring replaces this account&apos;s saved work after a confirmation. Keep backup files private.</p>
        <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] text-[var(--text-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">Text-only JSON for older copies</summary>
          <p className="mt-2 leading-5">Includes drafts, plans, and handoff references, but omits image and video files. Use the full backup to move media.</p>
          <div className="mt-3 flex flex-wrap gap-4"><button type="button" onClick={onExport} disabled={backupBusy} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] disabled:opacity-50"><Download size={13} /> Export text JSON</button><button type="button" onClick={() => textInput.current?.click()} disabled={backupBusy} className="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] disabled:opacity-50"><Upload size={13} /> Import text JSON</button><input ref={textInput} type="file" accept="application/json,.json" className="sr-only" disabled={backupBusy} aria-label="Choose a text-only Plypost JSON backup" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); event.target.value = ""; }} /></div>
        </details>
      </div>
    </details>
    <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="audit-heading">
      <div className="border-b border-[var(--line)] px-6 py-5 sm:px-7"><h2 id="audit-heading" className="text-[17px] font-bold">Account activity</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">Recent saved changes and worker results.</p></div>
      {auditLog.length === 0 ? <p className="px-6 py-8 text-[13px] text-[var(--text-soft)] sm:px-7">No activity yet.</p> : <div className="divide-y divide-[var(--line)] px-6 sm:px-7">{auditLog.slice(0, 12).map((item, index) => <div key={`${item.created_at}-${index}`} className="flex flex-wrap justify-between gap-2 py-3 text-[12px]"><span className="font-medium text-[var(--text-secondary)]">{item.action.replaceAll(".", " · ")}{item.detail ? ` · ${item.detail}` : ""}</span><time className="text-[var(--text-soft)]">{formatTime(item.created_at)}</time></div>)}</div>}
    </section>
    <section className="panel-border soft-shadow overflow-hidden rounded-[18px] bg-[var(--surface)]" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-5 sm:px-7"><div><h2 id="activity-heading" className="text-[17px] font-bold">Recent simulations</h2><p className="mt-1 text-[13px] text-[var(--text-muted)]">A local record of demo publishing runs in this browser.</p></div>{activity.length > 0 && <button type="button" onClick={onClearActivity} className="text-[13px] font-semibold text-[var(--accent-text)]">Clear history</button>}</div>
      {activity.length === 0 ? <div className="flex flex-col items-center px-6 py-10 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Clock3 size={20} /></span><p className="text-[14px] font-semibold text-[var(--text-secondary)]">Nothing simulated yet</p><p className="mt-1 text-[12px] text-[var(--text-soft)]">Your demo publishing activity will show up here.</p></div> : <div className="divide-y divide-[var(--line)]">{activity.map((item) => <div key={item.id} className="flex items-center gap-3 px-6 py-3.5 sm:px-7"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[12px] font-bold text-[var(--accent-text)]">{platforms[item.platform].name.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-[var(--text-secondary)]">{platforms[item.platform].name} <span className="ml-1 rounded-full bg-[var(--positive-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--positive)]">Simulated</span></span><span className="mt-0.5 block truncate text-[12px] text-[var(--text-soft)]">{item.content}</span></span><time className="shrink-0 text-[11px] text-[var(--text-soft)]">{formatTime(item.publishedAt)}</time></div>)}</div>}
    </section>
  </div>;
}
