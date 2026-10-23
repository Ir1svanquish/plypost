# Plypost

A responsive Next.js workspace for drafting one message, adapting it for Bluesky, Mastodon, LinkedIn and Threads, and reviewing each version before a **simulated** publishing run or a manual assisted publishing workflow. This release runs on your own computer; there is no hosted server.

## What works

- Write a source draft and select one to four destinations.
- Preview and edit a separate version for each platform. Unsaved editor text, selections and immediate demo activity stay in your browser.
- Sign in to the local app. Named drafts and scheduled plans are stored in a local SQLite database, so another device can read them if it can reach this same computer and signs in with the owner account.
- Export/import a JSON backup. Existing browser drafts and plans can be moved into the owner account after confirmation.
- Add selected platform drafts to a dated plan. A separate worker process simulates due items even when the browser is closed, as long as the computer and worker keep running. Jobs have recorded receipts, automatic retries and an activity log.
- Prepare assisted publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the original four platforms. Each item saves a text snapshot and an optional reminder time. Copy the text, open the platform, post there yourself, then mark the item posted. Plypost does not verify that mark.
- Due assisted items appear in the app. Browser alerts are optional and are sent only while this page is open after you click **Enable browser alerts** and grant permission.
- Ask a server-side Nebius Token Factory or NVIDIA Nemotron endpoint to create four tailored drafts. This is optional; the editor and simulation work without an API key.
- Run a server-side publishing simulation that validates nonempty text and platform character limits, then returns clearly labeled demo receipts. **No social platform API is called and nothing is posted.**
- Each platform has its own publishing adapter module under `src/lib/publishers`. The current adapters all use the simulation implementation, making real integrations an explicit future change.
- Use a responsive workspace with light, dark, or system appearance. The selection stays in this browser and follows system changes when set to **System**.

Named drafts and scheduled plans live in `data/plypost.sqlite` by default. The unsaved editor and assisted publishing checklist remain in this browser's local storage. Back up both the database and an exported JSON copy. Importing a backup replaces saved account drafts and plans plus this browser's assisted checklist after confirmation; it does not replace the current editor. Both publishing lists capture text snapshots. Dates are entered in your device's local time and stored as UTC instants; the plan also records the source time zone. Version 2 backups remain importable. Importing an overdue queued plan can cause the worker to simulate it promptly.

Plypost keeps the earlier browser storage keys after the rename, so existing SocialFlow AI drafts and plans remain available. The source repository is [Ir1svanquish/plypost](https://github.com/Ir1svanquish/plypost).

## Assisted publishing

1. Write a draft, then go to **Assisted publishing**. Select a platform and edit the text to copy. For the original four platforms, the field starts with that platform's current draft.
2. Leave the reminder time blank for an item ready now, or choose a future local time. Add it to the checklist.
3. When ready, click **Copy text**, then **Open platform**. Paste and review it on the platform, add media where required, and publish from your own account.
4. Click **I posted it** only after you have posted it yourself. This is a self-reported local status, and **Undo mark** is available.

The open links go to the platforms' public websites; some require further navigation to the correct account, Page, community or composer. The text is **not** passed in those links. Instagram, TikTok, YouTube and Pinterest require you to add suitable media on the destination platform. Browser alerts require permission and do not run while the app or browser is closed; the due list remains visible when you return.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the staged development plan and acceptance criteria.

## Run locally

Requires Node.js 24.14 or later and npm. Node 24.14's built-in SQLite module still prints an experimental warning. Run both the web app and worker on the same computer, from this repository directory.

```bash
npm install
cp .env.example .env.local
npm run hash-password
npm run dev
```

The password command prompts without echoing what you type and prints a `PLYPOST_OWNER_PASSWORD_HASH=...` line. Put that line and an email of your choice as `PLYPOST_OWNER_EMAIL=...` in `.env.local`. These two values are required to sign in. The password itself is never written to the file or Git. On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Start the worker in a second terminal:

```bash
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) and sign in. The worker reads the same `.env.local` file and SQLite database. Closing the browser does not stop the worker; shutting down the computer, stopping the worker, or sleeping the computer does. On restart, overdue queued tasks are picked up. For access from another device, expose the local app only over a trusted network; public hosting, TLS and managed database backup are later work.

To use AI adaptation, fill in one provider. The editor and simulation work without an AI key:

| Variable | Purpose |
| --- | --- |
| `NVIDIA_API_KEY` | NVIDIA API Catalog key for Nemotron |
| `NVIDIA_MODEL` | Defaults to `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_API_KEY` | Nebius Token Factory key |
| `NEBIUS_MODEL` | Exact chat model ID available to your Nebius account |
| `PLYPOST_OWNER_EMAIL` | Email used for the one owner account |
| `PLYPOST_OWNER_PASSWORD_HASH` | Salted scrypt hash from `npm run hash-password` |
| `PLYPOST_DB_PATH` | Optional SQLite file path; defaults to `data/plypost.sqlite` |

Restart the development server after editing `.env.local`. Select the matching provider in the app and click **Generate variants**. The key is read by `src/app/api/generate/route.ts` on the server and is never sent to the browser. The endpoint URL is fixed in server code; visitors cannot supply an arbitrary URL. The `.env*` ignore rule excludes real environment files while keeping `.env.example` in Git.

AI generation requires sign-in and allows at most 10 attempts per hour for the owner account. Sign-in is limited to five failed attempts per 15 minutes. Sessions use an HTTP-only cookie and are stored in SQLite. Only one owner account is supported in this release. Keep the database file private: it contains draft content, schedules, session hashes and activity records. Back it up while the app is stopped, or use SQLite's backup tools to include the WAL state.

Provider references: [Nebius OpenAI-compatible API](https://api.tokenfactory.nebius.com/docs) and [NVIDIA Nemotron API example](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b).

## Checks

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm audit
```

`npm test` starts the production build locally and exercises sign-in, protected routes, database persistence, validation, missing-key behavior, simulated publishing, and worker retry/idempotency. Run `npm run build` first.

## Scope and next steps

The scheduled worker automatically creates **simulation receipts only**. It never calls a social network. Assisted publishing still hands the final posting action to the user and cannot verify it. The displayed character limits are useful draft checks; Mastodon limits can vary by instance. Live platform OAuth, media uploads, production monitoring and public deployment remain future work. Before enabling real publishing, each adapter needs official authorization, platform-specific idempotency or reconciliation, and per-destination failure reporting.
