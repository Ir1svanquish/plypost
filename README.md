# Plypost

A responsive Next.js workspace for drafting one message, adapting it for Bluesky, Mastodon, LinkedIn and Threads, and reviewing each version before a **simulated** publishing run or a manual assisted publishing workflow. This release runs on your own computer; there is no hosted server.

## What works

- Write a source draft and select one to four destinations.
- Preview and edit a separate version for each platform. Each preview is illustrative and does not imply a connected account. Unsaved editor text, selections and immediate demo activity stay in your browser.
- Check each of the four platform drafts before sharing. Bluesky checks both 300 grapheme clusters and 3,000 UTF-8 bytes; other platform checks include advisory warnings for features that need review on the destination platform. Mastodon's actual limit can vary by server.
- Add up to four private JPEG, PNG or WebP images to a draft. Plypost verifies and re-encodes each image to remove metadata, then keeps it in the owner account's local SQLite database. Plan and assisted items keep the selected image IDs in order; their cards let you preview and download the images for manual posting. Simulation never sends images to social platforms.
- Sign in to the local app. Named drafts, scheduled plans and assisted publishing items are stored in a local SQLite database, so another browser can read them if it can reach this same computer and signs in with the owner account.
- Download or restore a **full portable backup** containing saved drafts, plans, assisted items and private images. It excludes login settings, sessions and audit data. The older text-only JSON backup remains available under Drafts, but omits image pixels; restoring image references from it requires those images to already exist in the account database. Missing references cause an error instead of silent data loss. Version 2/3 text backups remain importable.
- Add selected platform drafts to a dated plan. A separate worker process simulates due items even when the browser is closed, as long as the computer and worker keep running. A monthly calendar shows planned items and status filters; queued or failed items can be moved to a new time. Jobs have recorded receipts, automatic retries and an activity log.
- Prepare assisted publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the original four platforms. Each item saves a text and optional image snapshot with an optional reminder time. Copy the text, download any images, open the platform, post there yourself, then mark the item posted. Plypost does not verify that mark.
- Due assisted items appear in the app. Browser alerts are optional and are sent only while this page is open after you click **Enable browser alerts** and grant permission.
- Ask a server-side Nebius Token Factory or NVIDIA Nemotron endpoint to create four tailored drafts. Existing platform edits require confirmation before replacement and can be undone; over-limit AI results are flagged for editing. This is optional; the editor and simulation work without an API key.
- Run a server-side publishing simulation that validates nonempty text and platform character limits, then returns clearly labeled demo receipts. **No social platform API is called and nothing is posted.**
- Each platform has its own publishing adapter module under `src/lib/publishers`. The current adapters all use the simulation implementation, making real integrations an explicit future change.
- Use a responsive workspace with light, dark, or system appearance. The selection stays in this browser and follows system changes when set to **System**.
- Move between **Create**, **Drafts**, **Plan**, **Assisted**, and **Account**. The Create editor keeps destination choices and optional AI adaptation beside the draft; account changes and simulation history are in Account.

Saved drafts, private images, scheduled plans and assisted publishing items live in `data/plypost.sqlite` by default. The unsaved editor remains in this browser's local storage. Use **Download full backup** in Drafts to move saved content and images to another installation; keep the downloaded file private. Restoring it replaces this account's saved drafts, plans, handoffs and images, while the owner's login configuration remains local. The text-only JSON option omits image pixels and unsaved editor text. Plan and assisted items capture both text and selected image references at creation; later edits to the draft do not change them. Enter dates as `YYYY-MM-DD` and times in 24-hour `HH:mm` format. These are local times, stored as UTC instants; the plan records the source time zone. Importing an overdue queued plan can cause the worker to simulate it promptly.

Plypost keeps the earlier browser storage keys after the rename, so existing SocialFlow AI drafts and plans remain available. The source repository is [Ir1svanquish/plypost](https://github.com/Ir1svanquish/plypost).

## Assisted publishing

1. Write a draft, then go to **Assisted**. Select a platform and edit the text to copy. For the original four platforms, the field starts with that platform's current draft.
2. Leave the reminder time blank for an item ready now, or choose a future local time. Add it to the checklist.
3. When ready, click **Copy text**, download the saved images in order, then **Open platform**. Paste and review the text, upload the images, and publish from your own account.
4. Click **I posted it** only after you have posted it yourself. This is a self-reported status saved in your local account database, and **Undo mark** is available.

The open links go to the platforms' public websites; some require further navigation to the correct account, Page, community or composer. Text and images are **not** passed in those links. Instagram, TikTok, YouTube and Pinterest require you to add suitable media on the destination platform. Browser alerts require permission and do not run while the app or browser is closed; the due list remains visible when you return.

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

`npm test` exercises sign-in, protected routes, database persistence, validation, backup recovery, simulated publishing, and worker retry/idempotency against temporary databases. `npm run build` is a separate production compilation check.

## Scope and next steps

The scheduled worker automatically creates **simulation receipts only**. It never calls a social network. Assisted publishing still hands the final posting action to the user and cannot verify it. The displayed checks do not replace the destination platform's composer; Mastodon limits can vary by instance. Image upload here is private local storage and manual download, not a social platform media upload. Live platform OAuth, production monitoring and public deployment remain future work. Before enabling real publishing, each adapter needs official authorization, platform-specific idempotency or reconciliation, and per-destination failure reporting.

Platform checks are based on the [Bluesky post lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json), the [AT Protocol string length specification](https://atproto.com/specs/lexicon), and [Mastodon's instance configuration](https://docs.joinmastodon.org/entities/Instance/). Warnings for rich text, tagging and server-specific behavior require manual review on the platform.
