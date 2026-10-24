# Plypost

Plypost is a local web app for drafting and planning social posts. It runs on your computer with one owner account; there is no hosted Plypost service.

## What you can do

- Write one draft, then edit separate versions for Bluesky, Mastodon, LinkedIn and Threads. Preview the text and selected images before sharing. Optional AI adaptation uses a Nebius or NVIDIA key stored on the server.
- Save drafts and up to four ordered images with optional descriptions in local SQLite. Export a full backup from **Drafts**.
- Put posts on a calendar as simulations or manual reminders. A local worker processes due simulations and individually confirmed Mastodon posts while your computer is running.
- Prepare manual publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit and the four draft platforms. Copy the text and image descriptions, download images, publish on the platform, then record the result yourself.
- Generate weekly ideas from a saved brand brief. Each idea needs your review before it becomes a draft. Clicking **Generate ideas** sends the brand brief to your selected AI provider; self-reported post results stay local.

| Publishing mode | What happens |
| --- | --- |
| Simulation | Creates a demo receipt. Nothing is sent to a social platform. |
| Assisted | Gives you text, images and a link to the platform. You publish there yourself; Plypost cannot verify the post. |
| Mastodon live | Sends a confirmed text-only post immediately, or at a confirmed time if the local worker is running. Requires an account and OAuth setup. |
| Bluesky live | Sends a confirmed text-only post immediately. Requires an account and OAuth setup. |

Images are available for assisted publishing, not live API posting. Real Mastodon and Bluesky account flows have **not** yet been tested against live accounts.

## Run locally

Requires Node.js 24.14 or later and npm. From the project directory:

```bash
npm install
cp .env.example .env.local
npm run hash-password
```

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`. Add the printed `PLYPOST_OWNER_PASSWORD_HASH` line and your `PLYPOST_OWNER_EMAIL` to `.env.local`. Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in. To process due items, start a second terminal in the same directory:

```bash
npm run worker
```

The worker uses the same local SQLite database. It stops when the process or computer stops; restart it after updating the app. Saved content is in `data/plypost.sqlite` by default. Keep the database and exported backups private. The `.env.local` file is ignored by Git.

### Optional connections

- **AI:** Set `NVIDIA_API_KEY` or `NEBIUS_API_KEY` in `.env.local`. Drafting, planning and simulation still work without an AI key; AI generation does not.
- **Mastodon:** If you do not have an account, skip this. Otherwise set `PLYPOST_MASTODON_INSTANCE` to your server's HTTPS origin, `PLYPOST_PUBLIC_ORIGIN` to the app's exact browser origin, and `PLYPOST_MASTODON_SECRET` to 64 random hex characters. Restart the app and connect under **Account**. Real scheduled posts also need the worker. Set `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` and restart both processes to stop accepting and dispatching future real schedules.
- **Bluesky:** Set `PLYPOST_BLUESKY_ORIGIN=http://127.0.0.1:3000` and a separate 64-character `PLYPOST_BLUESKY_SECRET`. Restart the app and open that exact `127.0.0.1` address before connecting under **Account**. This OAuth flow is local only.

Generate each encryption secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

A full backup contains drafts, plans, assisted items, settings and images. It excludes login credentials and live publishing queues. Restoring a backup does not cancel real Mastodon posts already queued on this installation.

## Checks and current limits

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The first four checks passed locally on 2026-10-24. The production dependency audit still reports 15 high entries tied to a [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) in the official AT Protocol OAuth client. Plypost caps OAuth responses before parsing as a mitigation, but that does not fix the upstream dependency. Public deployment of Bluesky authorization should wait for a compatible fix and live account testing.

LinkedIn and Threads are currently draft, simulation and assisted destinations; they do not have connected publishing. See [platform integration notes](PLATFORM_INTEGRATIONS.md) for access requirements and the [development plan](DEVELOPMENT_PLAN.md) for remaining work.
