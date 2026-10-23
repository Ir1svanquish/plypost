# Plypost

A responsive Next.js workspace for drafting one message, adapting it for Bluesky, Mastodon, LinkedIn and Threads, and reviewing each version before a **simulated** publishing run or a manual assisted publishing workflow. An optional, separately configured Mastodon connection can send a text post after explicit confirmation. This release runs on your own computer; there is no hosted server.

## What works

- Write a source draft and select one to four destinations. Opening another draft, a planned item or a new draft with unsaved edits offers save, discard or keep editing; closing the page also warns about unsaved edits.
- Preview and edit a separate version for each platform. Each preview is illustrative and does not imply a connected account. Unsaved editor text, selections and immediate demo activity stay in your browser.
- Check each of the four platform drafts before sharing. Bluesky checks both 300 grapheme clusters and 3,000 UTF-8 bytes; other platform checks include advisory warnings for features that need review on the destination platform. Mastodon's actual limit can vary by server.
- Add up to four private JPEG, PNG or WebP images to a draft. Plypost verifies and re-encodes each image to remove metadata, then keeps it in the owner account's local SQLite database. Plan and assisted items keep the selected image IDs in order; their cards let you preview and download the images for manual posting. Simulation never sends images to social platforms.
- Sign in to the local app. Named drafts, scheduled plans and assisted publishing items are stored in a local SQLite database, so another browser can read them if it can reach this same computer and signs in with the owner account.
- Download or restore a **full portable backup** containing saved drafts, plans, assisted items and private images. It excludes login settings, sessions and audit data. The older text-only JSON backup remains available under Drafts, but omits image pixels; restoring image references from it requires those images to already exist in the account database. Missing references cause an error instead of silent data loss. Version 2/3 text backups remain importable.
- Add selected platform drafts to a dated plan. A separate worker process simulates due items even when the browser is closed, as long as the computer and worker keep running. A monthly calendar shows simulated jobs and manual handoffs with separate status filters; queued or failed simulations can be moved to a new time. Jobs have recorded receipts, automatic retries and an activity log.
- Prepare assisted publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the original four platforms. Each item saves a text and optional image snapshot with an optional reminder time. Copy the text, download any images, open the platform, post there yourself, then mark the item posted. You may add, correct or remove a public HTTPS post link afterward without changing the completion time. Plypost stores your mark, link and completion time but does not verify the platform post.
- Due assisted items appear in the app. Browser alerts are optional and are sent only while this page is open after you click **Enable browser alerts** and grant permission.
- Ask a server-side Nebius Token Factory or NVIDIA Nemotron endpoint to create four tailored drafts. Existing platform edits require confirmation before replacement and can be undone; over-limit AI results are flagged for editing. This is optional; the editor and simulation work without an API key.
- Run a server-side publishing simulation that validates nonempty text and platform character limits, then returns clearly labeled demo receipts. **No social platform API is called and nothing is posted.**
- Optionally connect one Mastodon account through its official authorization page and publish a reviewed text-only Mastodon version. This is a separate action from simulation and scheduled plans; it is disabled until its server settings are configured. Images remain a manual handoff. Real account authorization and posting have not been verified against a live instance in this repository.
- Each platform has its own publishing adapter module under `src/lib/publishers`. The current adapters all use the simulation implementation, making real integrations an explicit future change.
- Use a responsive workspace with light, dark, or system appearance. The selection stays in this browser and follows system changes when set to **System**.
- Move between **Create**, **Drafts**, **Plan**, **Assisted**, and **Account**. The Create editor keeps destination choices and optional AI adaptation beside the draft; account changes and simulation history are in Account.

Saved drafts, private images, scheduled plans and assisted publishing items live in `data/plypost.sqlite` by default. The unsaved editor remains in this browser's local storage. Use **Download full backup** in Drafts to move saved content and images to another installation; keep the downloaded file private. Restoring it replaces this account's saved drafts, plans, handoffs and images, while the owner's login configuration remains local. The text-only JSON option omits image pixels and unsaved editor text. Plan and assisted items capture both text and selected image references at creation; later edits to the draft do not change them. Enter dates as `YYYY-MM-DD` and times in 24-hour `HH:mm` format. These are local times, stored as UTC instants; the plan records the source time zone. Importing an overdue queued plan can cause the worker to simulate it promptly.

Plypost keeps the earlier browser storage keys after the rename, so existing SocialFlow AI drafts and plans remain available. The source repository is [Ir1svanquish/plypost](https://github.com/Ir1svanquish/plypost).

## Assisted publishing

1. Write a draft, then go to **Assisted**. Select a platform and edit the text to copy. For the original four platforms, the field starts with that platform's current draft.
2. Leave the reminder time blank for an item ready now, or choose a future local time. Add it to the checklist.
3. When ready, click **Copy text**, download the saved images in order, then **Open platform**. Paste and review the text, upload the images, and publish from your own account.
4. After posting, optionally paste the public post URL and click **I posted it**. You can also use **Add recorded link** or **Edit recorded link** later, and remove a recorded link without changing the completion time. Plypost checks the URL format (HTTPS, public-style hostname, no embedded credentials, at most 2,048 characters), then saves your self-reported status, link and timestamp. It does not check the destination account or whether the post exists. **Undo mark** removes the link and completion time.

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
| `PLYPOST_MASTODON_INSTANCE` | Optional trusted Mastodon HTTPS origin, such as `https://mastodon.example` |
| `PLYPOST_PUBLIC_ORIGIN` | This app's exact origin for the Mastodon OAuth callback |
| `PLYPOST_MASTODON_SECRET` | 32 random bytes (64 hex characters) for encrypting Mastodon credentials in SQLite |

Restart the development server after editing `.env.local`. Select the matching provider in the app and click **Generate variants**. The key is read by `src/app/api/generate/route.ts` on the server and is never sent to the browser. The endpoint URL is fixed in server code; visitors cannot supply an arbitrary URL. The `.env*` ignore rule excludes real environment files while keeping `.env.example` in Git.

AI generation requires sign-in and allows at most 10 attempts per hour for the owner account. Sign-in is limited to five failed attempts per 15 minutes. Sessions use an HTTP-only cookie and are stored in SQLite. Only one owner account is supported in this release. Keep the database file private: it contains draft content, schedules, session hashes and activity records. Back it up while the app is stopped, or use SQLite's backup tools to include the WAL state.

Provider references: [Nebius OpenAI-compatible API](https://api.tokenfactory.nebius.com/docs) and [NVIDIA Nemotron API example](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b).

## Optional Mastodon live posting

Set `PLYPOST_MASTODON_INSTANCE`, `PLYPOST_MASTODON_SECRET`, and `PLYPOST_PUBLIC_ORIGIN` in `.env.local`, then restart the app. `PLYPOST_MASTODON_INSTANCE` must be the exact HTTPS origin of the instance you intend to use, without a path, query or trailing slash. `PLYPOST_PUBLIC_ORIGIN` is the URL where this app is reachable; its callback is `/api/mastodon/callback`. For local testing, use `http://127.0.0.1:3000` if the chosen Mastodon instance accepts that redirect. Some instances may require a public HTTPS URL. Generate an encryption secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In **Account**, choose **Connect Mastodon** and approve the requested profile and status-writing permissions on that instance. The server registers an app for this configured instance, validates the OAuth callback, and stores the access token and app secret encrypted in local SQLite. The secret stays only in `.env.local`; losing it means the saved connection cannot be decrypted. **Disconnect** attempts to revoke the token and removes the local connection. The portable backup excludes these credentials and the posting attempt log.

In **Create**, review the Mastodon version, select Mastodon as a destination, and use the separate live-post action. It asks for confirmation before sending. It supports plain text only; a draft with images cannot use this action. The plan worker and **Simulate publish** button remain simulation-only. Each live attempt has a durable request ID and records the platform post ID and any URL the instance returns. If the network result is uncertain, Plypost records **Result unknown** and blocks an identical new attempt; it does not blindly retry. Check the connected Mastodon account, then record **I found the post** or **No post found** under Recent live attempts. Those choices are your own report, not a platform-verified receipt. Marking a post found keeps identical text blocked; marking it absent allows another attempt and may create a duplicate if your check was mistaken. This first implementation still needs a real test-account authorization, post and revoke check before it can be called end-to-end verified. See the [Mastodon OAuth API](https://docs.joinmastodon.org/methods/oauth/) and [status posting API](https://docs.joinmastodon.org/methods/statuses/) for platform details.

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

The scheduled worker automatically creates **simulation receipts only**. It never calls a social network. Assisted publishing still hands the final posting action to the user and cannot verify it. The displayed checks do not replace the destination platform's composer; Mastodon limits can vary by instance. Image upload here is private local storage and manual download, not a social platform media upload. The optional Mastodon live-text path is separate and awaits real-account validation. Other platform connections, live scheduled delivery, production monitoring and public deployment remain future work.

Platform checks are based on the [Bluesky post lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json), the [AT Protocol string length specification](https://atproto.com/specs/lexicon), and [Mastodon's instance configuration](https://docs.joinmastodon.org/entities/Instance/). Warnings for rich text, tagging and server-specific behavior require manual review on the platform.
