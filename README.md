# Plypost

A responsive Next.js workspace for drafting one message, adapting it for Bluesky, Mastodon, LinkedIn and Threads, and reviewing each version before a **simulated** publishing run or a manual assisted publishing workflow. Separate optional account connections can send a confirmed plain-text post immediately to Bluesky or Mastodon; Mastodon also has a separately confirmed real schedule. This release runs on your own computer; there is no hosted server.

## What works

- Write a source draft and select one to four destinations. Opening another draft, a planned item or a new draft with unsaved edits offers save, discard or keep editing; closing the page also warns about unsaved edits.
- Preview and edit a separate version for each platform. Each preview is illustrative and does not imply a connected account. Unsaved editor text, selections and immediate demo activity stay in your browser.
- Check each of the four platform drafts before sharing. Bluesky checks both 300 grapheme clusters and 3,000 UTF-8 bytes; other platform checks include advisory warnings for features that need review on the destination platform. Mastodon's actual limit can vary by server.
- Add up to four private JPEG, PNG or WebP images to a draft. Plypost verifies and re-encodes each image to remove metadata, then keeps it in the owner account's local SQLite database. Plan and assisted items keep the selected image IDs in order; their cards let you preview and download the images for manual posting. Simulation never sends images to social platforms.
- Sign in to the local app. Named drafts, scheduled plans and assisted publishing items are stored in a local SQLite database, so another browser can read them if it can reach this same computer and signs in with the owner account.
- If the same saved draft changes in another window, an older editor cannot overwrite or delete it. Your text stays in place, and you can save it as a new draft or open the latest saved version. Unsaved editor text in two windows can still differ, so save named drafts when switching devices.
- Download or restore a **full portable backup** containing saved drafts, plans, assisted items, weekly slot settings and private images. It excludes login settings, sessions and audit data. The older text-only JSON backup remains available under Drafts, but omits image pixels and weekly slot settings; restoring image references from it requires those images to already exist in the account database. Missing references cause an error instead of silent data loss. Version 2/3 text backups remain importable.
- In **Plan**, save a brand brief and ask the configured Nebius or NVIDIA model for up to three weekly content ideas. Each idea has a suggested angle, rationale, source draft and destinations. Edit an idea before approving it into an ordinary saved draft; no idea is published or queued automatically. The rationale is model output, not an independently verified recommendation.
- Add selected platform drafts to a dated simulation plan. A separate worker process simulates due items even when the browser is closed, as long as the computer and worker keep running. The Plan calendar shows real Mastodon schedules, simulated jobs and manual handoffs with distinct status filters; queued or failed simulations and pending manual reminders can be moved to a new time. Moving a manual reminder keeps its reviewed text, images and draft link, and clears the old notification marker. Simulation jobs have recorded receipts, automatic retries and an activity log. In Plan, optional weekly slots can suggest the next free reminder time per platform when preparing manual handoffs from a saved draft.
- Select a future day in the Plan calendar and choose **Prepare manual post for this day** to open Assisted with a reminder time filled in. It uses 09:00 if that is still ahead; for today after 09:00, it uses the next quarter-hour at least 15 minutes ahead. Review the destination, text and time before saving; this action does not queue a real platform post.
- Prepare assisted publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the original four platforms. Each item saves a text and optional image snapshot with an optional reminder time. Copy the text, download any images, open the platform, post there yourself, then mark the item posted. You may add, correct or remove a public HTTPS post link afterward without changing the completion time. Plypost stores your mark, link and completion time but does not verify the platform post.
- From a saved draft, review its Bluesky, Mastodon, LinkedIn and Threads versions together and explicitly prepare one assisted item per selected destination. Each destination can have its own local reminder time; a blank reminder makes the item ready now. Plypost snapshots the saved text and images, so later draft edits do not silently change a prepared handoff. The Plan page shows how many handoffs from an approved idea are prepared or self-reported posted.
- On a completed assisted item, optionally record views, likes, replies or a short result note. These numbers and notes are self-reported, can be edited or cleared, and are not fetched from the platform. They remain local and are not sent with AI weekly-plan requests. A small set of manually entered results cannot establish that a posting time or topic caused better performance.
- Due assisted items appear in the app. Browser alerts are optional and are sent only while this page is open after you click **Enable browser alerts** and grant permission.
- Ask a server-side Nebius Token Factory or NVIDIA Nemotron endpoint to create four tailored drafts. Existing platform edits require confirmation before replacement and can be undone; over-limit AI results are flagged for editing. This is optional; the editor and simulation work without an API key.
- Run a server-side publishing simulation that validates nonempty text and platform character limits, then returns clearly labeled demo receipts. **No social platform API is called and nothing is posted.**
- Optionally connect one Mastodon account through its official authorization page and publish a reviewed text-only Mastodon version immediately. **Plan** has a separate real Mastodon queue: review the exact account, text and local time, then confirm each item before it can be sent by the running worker. The calendar displays this queue alongside simulations and manual reminders, clearly marked as a real post. Images remain a manual handoff. Real account authorization and posting have not been verified against a live instance in this repository.
- Optionally connect one Bluesky account through its official OAuth page, then confirm an immediate plain-text post from **Create** after reviewing the exact account and text. OAuth requests post-creation access only, and state and sessions are encrypted in SQLite. A result with no confirmed receipt needs a manual check on Bluesky. No real Bluesky account has been used for validation. The ordinary Bluesky adapter and calendar remain simulated.
- Each platform has its own publishing adapter module under `src/lib/publishers`. The current adapters all use the simulation implementation, making real integrations an explicit future change.
- Use a responsive workspace with light, dark, or system appearance. The selection stays in this browser and follows system changes when set to **System**.
- Move between **Create**, **Drafts**, **Plan**, **Assisted**, and **Account**. The Create editor keeps destination choices and optional AI adaptation beside the draft; account changes and simulation history are in Account.

Saved drafts, private images, scheduled plans, assisted publishing items, weekly slots, brand details and AI weekly proposals live in `data/plypost.sqlite` by default. The unsaved editor remains in this browser's local storage. Use **Download full backup** in Drafts to move saved content and images to another installation; keep the downloaded file private. The version 3 full backup includes weekly slots as well as brand details, proposals, approvals and self-reported assisted results. Restoring it replaces this account's saved content, weekly slots and media, while the owner's login configuration remains local. Older version 1 and 2 full backups still import; because they lack weekly slots, restoring them clears the current slot settings. The text-only JSON option omits image pixels, weekly slots, brand details, AI plans and unsaved editor text. Importing a text-only backup replaces drafts, publishing plans and assisted items, clears existing AI weekly proposals whose approved draft links would otherwise become invalid, and keeps the brand profile and weekly slots. Plan and assisted items capture both text and selected image references at creation; later edits to the draft do not change them. Enter dates as `YYYY-MM-DD` and times in 24-hour `HH:mm` format. These are local times, stored as UTC instants; the plan records the source time zone. Importing an overdue queued plan can cause the worker to simulate it promptly.

Plypost moves the earlier shared editor cache into the first signed-in owner's browser cache, then keeps unsaved editor text separate for each configured owner. Older SocialFlow AI browser drafts, plans and assisted items are shown after sign-in but stay in the browser until you review their titles, destinations and times and confirm migration. The older browser copy has no account label, so check that it belongs in the signed-in account. If old drafts or plans exist, migration replaces the account's saved drafts and simulation plan; missing assisted items are merged while existing ones remain. An assisted-only browser copy leaves account drafts and plans untouched. Invalid browser data is left in place for review. The source repository is [Ir1svanquish/plypost](https://github.com/Ir1svanquish/plypost).

## Assisted publishing

1. Write and save a draft. In **Create**, choose **Prepare assisted handoffs** to review the saved versions for Bluesky, Mastodon, LinkedIn and Threads, choose destinations and optional individual reminder times, then confirm the batch. Save any newer editor changes first. For X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest or Reddit, use **Assisted** to add an item individually.
2. Leave a reminder time blank for an item ready now, or choose a future local time. The original single-item form remains available in **Assisted**.
3. When ready, click **Copy text**, download the saved images in order, then **Open platform**. Paste and review the text, upload the images, and publish from your own account.
4. After posting, optionally paste the public post URL and click **I posted it**. You can also use **Add recorded link** or **Edit recorded link** later, and remove a recorded link without changing the completion time. Plypost checks the URL format (HTTPS, public-style hostname, no embedded credentials, at most 2,048 characters), then saves your self-reported status, link and timestamp. It does not check the destination account or whether the post exists. **Undo mark** removes the link and completion time.
5. Optionally enter post results on a marked item. Record only values you know; leave other fields blank. Plypost labels these results as your own report and never treats them as verified analytics.

The open links go to the platforms' public websites; some require further navigation to the correct account, Page, community or composer. Text and images are **not** passed in those links. Instagram, TikTok, YouTube and Pinterest require you to add suitable media on the destination platform. Browser alerts require permission and do not run while the app or browser is closed; the due list remains visible when you return.

For recurring manual posts, expand **Weekly posting slots** in Plan. Choose an IANA time zone and add platform, weekday and local time combinations. In a saved draft's **Prepare assisted handoffs** review, select destinations, click **Preview next free slots**, inspect the suggested dates, then choose **Use these reminder times** and confirm the batch. The preview searches eight weeks ahead and skips the same platform's occupied reminder, simulation or confirmed Mastodon real-post minute. Another tab can take a slot after preview; the final confirmation checks again and rejects the whole batch if a chosen minute is no longer free. Existing scheduled items do not move when the slot rules change. A nonexistent spring daylight-saving time is skipped; a repeated fall time uses its first occurrence. These slots create manual checklist reminders only, never automatic platform posts.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the staged development plan and acceptance criteria, and [PLATFORM_INTEGRATIONS.md](PLATFORM_INTEGRATIONS.md) for official platform access requirements.

## AI weekly planning

Open **Plan** and complete the brand brief: who you serve, the goal, writing style, content pillars, known facts and target destinations. Choose a Monday and the configured AI provider, then generate a short plan. Clicking **Generate ideas** sends the saved brand brief to the selected AI provider. Self-reported post results are not included. Treat the suggestions as proposals: check every factual statement, edit the seed and platforms, then approve an idea to create a saved draft. Continue in **Create** to review its platform versions and decide whether to schedule a simulation or prepare an assisted handoff. No model response can send a post or approve itself.

The brand brief and proposals are stored in the local owner database and optional full backup. When you click **Generate ideas**, the server sends the brand brief to the selected provider's API. No assisted outcome metrics or notes are included. Without a provider key, planning returns a configuration error; it does not invent example results. Plypost does not import live analytics or prove that an AI recommendation will grow an account.

## Run locally

Requires Node.js 24.14 or later and npm. Node 24.14's built-in SQLite module still prints an experimental warning. Run both the web app and worker on the same computer, from this repository directory.

```bash
npm install
cp .env.example .env.local
npm run hash-password
npm run dev
```

The development command uses Next.js's Webpack mode. On some Windows setups, the default Turbopack mode cannot create a dependency junction and leaves API routes unavailable; Webpack avoids that development-only failure.

The password command prompts without echoing what you type and prints a `PLYPOST_OWNER_PASSWORD_HASH=...` line. Put that line and an email of your choice as `PLYPOST_OWNER_EMAIL=...` in `.env.local`. These two values are required to sign in. The password itself is never written to the file or Git. On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Start the background worker in a second terminal:

```bash
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) and sign in. The worker reads the same `.env.local` file and SQLite database. **Restart the worker after updating Plypost** so it has the current real-post capability. Closing the browser does not stop the worker; shutting down the computer, stopping the worker, or sleeping the computer does. On restart, overdue queued simulation tasks and separately confirmed Mastodon real posts can be processed. Check the real queue before relying on a due post; an uncertain send is never automatically retried. For access from another device, expose the local app only over a trusted network; public hosting, TLS and managed database backup are later work.

To use AI adaptation or weekly planning, fill in one provider. The editor and simulation work without an AI key:

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
| `PLYPOST_MASTODON_SCHEDULE_ENABLED` | Optional emergency stop: set `false` to stop accepting and dispatching real Mastodon schedules; default is enabled. Restart both web and worker after changing it. Existing queued items stay queued until cancelled or the switch is restored. |
| `PLYPOST_BLUESKY_ORIGIN` | Optional exact local loopback origin, such as `http://127.0.0.1:3000`, for the Bluesky OAuth callback. |
| `PLYPOST_BLUESKY_SECRET` | Separate 32-byte key (64 hex characters) for encrypting Bluesky OAuth state, refresh sessions and DPoP keys in SQLite. |

Restart the development server after editing `.env.local`. Select the matching provider in the app and click **Generate variants**. The key is read by `src/app/api/generate/route.ts` on the server and is never sent to the browser. The endpoint URL is fixed in server code; visitors cannot supply an arbitrary URL. The `.env*` ignore rule excludes real environment files while keeping `.env.example` in Git.

AI generation requires sign-in and allows at most 10 attempts per hour for the owner account, shared across draft adaptation and weekly planning. Sign-in is limited to five failed attempts per 15 minutes. Sessions use an HTTP-only cookie and are stored in SQLite. Only one owner account is supported in this release. Keep the database file private: it contains draft content, brand details, schedules, session hashes and activity records. Back it up while the app is stopped, or use SQLite's backup tools to include the WAL state.

Provider references: [Nebius OpenAI-compatible API](https://api.tokenfactory.nebius.com/docs) and [NVIDIA Nemotron API example](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b).

## Optional Mastodon live posting

Set `PLYPOST_MASTODON_INSTANCE`, `PLYPOST_MASTODON_SECRET`, and `PLYPOST_PUBLIC_ORIGIN` in `.env.local`, then restart the app. `PLYPOST_MASTODON_INSTANCE` must be the exact HTTPS origin of the instance you intend to use, without a path, query or trailing slash. `PLYPOST_PUBLIC_ORIGIN` is the URL where this app is reachable; its callback is `/api/mastodon/callback`. For local testing, use `http://127.0.0.1:3000` if the chosen Mastodon instance accepts that redirect. Some instances may require a public HTTPS URL. Generate an encryption secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In **Account**, choose **Connect Mastodon** and approve the requested profile and status-writing permissions on that instance. The server registers an app for this configured instance, validates the OAuth callback, and stores the access token and app secret encrypted in local SQLite. The secret stays only in `.env.local`; losing it means the saved connection cannot be decrypted. **Disconnect** attempts to revoke the token and removes the local connection. The portable backup excludes these credentials, live posting attempts and the real scheduled queue; restoring a content backup does not cancel real posts already queued on this installation.

In **Create**, review the Mastodon version, select Mastodon as a destination, and use the separate live-post action. It asks for confirmation before sending. In **Plan**, the real Mastodon section lets you review and confirm a time for that same text-only account; the queued item locks the exact text, connected account and local time. Later draft edits do not change it. Images are not uploaded by either path. **Add simulation** and **Simulate publish** remain simulation-only; the calendar also displays the separate real queue.

The separate scheduling module records a durable request ID and any platform post ID/URL received. Its worker takes each confirmed due item once. A network timeout, process crash or other uncertain result leaves the task **Result unknown** for you to check on Mastodon; it is never automatically sent again. A found/absent check is your report, not a platform-verified receipt. Disconnecting the account cancels queued real tasks. Setting `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` and restarting web and worker stops new real queue entries and future dispatch, but cannot recall a request already in flight. This implementation still needs a real test-account authorization, scheduled post and revoke check before it can be called end-to-end verified. See the [Mastodon OAuth API](https://docs.joinmastodon.org/methods/oauth/) and [status posting API](https://docs.joinmastodon.org/methods/statuses/) for platform details.

## Optional Bluesky live text posting

Set `PLYPOST_BLUESKY_ORIGIN` to the exact `http://127.0.0.1:<port>` address used in the browser, and set an independent `PLYPOST_BLUESKY_SECRET` to 64 random hex characters. Restart the app and open that exact address, rather than `localhost`. In **Account**, enter your Bluesky handle and select **Connect Bluesky**. After authorizing, check the connected account DID shown there. In **Create**, select Bluesky, review its text version and confirm the separate live-post prompt. Images remain a manual handoff. The official Node OAuth client uses a loopback client ID, a `127.0.0.1` callback, PKCE/PAR/DPoP and the narrow `atproto repo:app.bsky.feed.post?action=create` scope. The callback is tied to a live Plypost owner session and a short-lived, HTTP-only nonce cookie; SDK state and account sessions are encrypted in local SQLite. The callback may not work if the chosen authorization server disallows loopback clients. Public HTTPS OAuth metadata and multi-process token-refresh locking are not implemented yet.

The endpoints under `/api/bluesky/` cover connection status, OAuth start/callback, immediate plain-text posting, recent attempt status, manual result checks and disconnect. Only an authenticated same-origin POST can start authorization or send a text post; no worker dispatches Bluesky content. Publishing reserves a durable request ID before the network call and checks that the confirmed account DID still matches. If the outcome is uncertain, it is reported as `unknown` and the same request is never sent again. After checking Bluesky, the owner can mark that attempt `found` or `absent` in **Create**; this is a self-report, never a verified API receipt. A fresh request ID for the same text is accepted only after an `absent` report, and could create a duplicate if the check was wrong. Images, rich-text facets and scheduling remain unimplemented. Local mock tests verify route guards, encrypted persistence and attempt handling, but no real account authorization, post or revoke has been tested. See the [official OAuth guide](https://atproto.com/guides/oauth-tutorial) and [record writing guide](https://atproto.com/guides/writing-data).

**Dependency gate for public deployment (checked 2026-10-24):** `npm audit --omit=dev --audit-level=high` reports 15 high entries from one [Zod memory-exhaustion advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) in the official AT Protocol OAuth client's dependency tree. The installed client requires Zod 3, while the advisory lists a patch only in Zod 4.6.6; forcing a major-version override has not been validated. Plypost limits its own request bodies and keeps this OAuth path optional and local-only, but that does not prove all upstream response paths safe. Resolve or demonstrably mitigate this dependency before exposing Bluesky OAuth on a public server.

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

The ordinary four-platform plan and its retry logic still create **simulation receipts only**. The separate Mastodon queue can send confirmed real text posts while the local worker runs; Bluesky can send only an immediate text post after an individual confirmation. Assisted publishing still hands the final posting action to the user and cannot verify it. The displayed checks do not replace the destination platform's composer; Mastodon limits can vary by instance. Image upload here is private local storage and manual download, not a social platform media upload. Real Mastodon and Bluesky account flows await test-account validation. LinkedIn and Threads connections, production monitoring and public deployment remain future work.

Platform checks are based on the [Bluesky post lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json), the [AT Protocol string length specification](https://atproto.com/specs/lexicon), and [Mastodon's instance configuration](https://docs.joinmastodon.org/entities/Instance/). Warnings for rich text, tagging and server-specific behavior require manual review on the platform.
