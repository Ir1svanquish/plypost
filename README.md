# Plypost

Plypost is a web app that runs on your computer. Write a post, edit versions for different platforms, save drafts, and plan when to publish. There is no hosted Plypost service.

## What works

- Draft and preview posts for Bluesky, Mastodon, LinkedIn, and Threads, with up to four images.
- Save drafts, set reminders, and export a local backup. The calendar can process simulated posts while the worker is running.
- Review separate handoffs from a saved draft for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the four draft platforms. Edit each handoff, then publish on those sites yourself and record the result in Plypost.
- Optionally use Nebius or NVIDIA Nemotron to rewrite drafts or suggest weekly ideas. AI requests are made only when you choose to generate them. Weekly idea generation sends your saved brand brief, not your recorded post results.

The separate Bluesky and Mastodon account features can send confirmed text posts; Mastodon also has a confirmed scheduling queue. **Neither account flow has been tested with a live account yet.** Images are for manual publishing, not these account features. Ordinary reminders and simulated posts never publish to a social platform.

## Run on your computer

Requires Node.js 24.14 or later and npm. In PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
npm run hash-password
```

Put your email and the printed password hash into `PLYPOST_OWNER_EMAIL` and `PLYPOST_OWNER_PASSWORD_HASH` in `.env.local`. Then run:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To process due simulations or confirmed Mastodon schedules, run `npm run worker` in a second terminal. The worker stops when your computer sleeps or the process closes.

The app keeps data in `data/plypost.sqlite` by default. Keep this file and exported backups private. `.env.local` and `data/` are excluded from Git.

## Optional connections

- **AI:** Add `NVIDIA_API_KEY` or `NEBIUS_API_KEY` to `.env.local`. Drafting and manual publishing work without either key.
- **Bluesky:** Set the local origin and encryption key shown in [.env.example](.env.example), then connect in **Account**. The browser address must match the configured origin.
- **Mastodon:** Skip this if you do not have an account. Otherwise use the instance, origin, and encryption settings in [.env.example](.env.example), then connect in **Account**. Confirmed scheduled posts need the worker. Set `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` and restart the app and worker to pause future dispatch.

For either account connection, generate a separate encryption key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Restoring a backup does not cancel real Mastodon posts already queued on this installation.

## Check changes

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

These checks passed locally on 2026-10-24; a live deployment has not been set up. The current production dependency audit reports high-severity entries through the AT Protocol OAuth client's Zod dependency. OAuth response-size limits reduce exposure but do not fix the dependency. Check `npm audit --omit=dev --audit-level=high` before exposing Bluesky login publicly.

See the [development plan](DEVELOPMENT_PLAN.md) and [platform notes](docs/platforms.md) for remaining work.
