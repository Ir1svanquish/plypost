<p align="center">
  <img src="public/plypost-mark.svg" width="72" alt="Plypost logo" />
</p>

<h1 align="center">Plypost</h1>

<p align="center">Write once. Shape it for each platform. Keep it sounding like you.</p>

<p align="center">
  <a href="https://plypost.onrender.com/">Demo</a> ·
  <a href="https://youtu.be/_Wx8P9_RcQg">Watch the walkthrough</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="LICENSE">MIT License</a>
</p>

Plypost is a self-hosted workspace for writing, adapting and reviewing social posts. Start with a note or an image, use AI to explore the wording, and prepare each version for publishing.

Built with Next.js, TypeScript, Tailwind CSS and SQLite. AI writing uses NVIDIA Nemotron through Nebius Token Factory.

## Features

- **Write with AI.** Generate a caption from a selected image, rewrite a draft, or adapt it for a different platform.
- **Use your own style.** Analyze 3–6 past posts to create an editable writing guide for future suggestions.
- **Review before sharing.** Compare versions with the source, edit suggestions, and choose which changes to keep.
- **Keep drafts together.** Save text, images, a short video, image descriptions and location notes in one workspace.
- **Plan your posts.** Organize drafts on a calendar, add reminders and generate weekly ideas from a brand brief.
- **Prepare each destination.** Choose platform-specific text and media, then copy or download a publishing package.
- **Back up your work.** Export and restore drafts, attached media and your writing guide.

AI is optional. Drafts, media, planning and manual publishing preparation work without an API key.

## How it works

1. **Create** a draft and add images or a video with the **+** control.
2. Open **Write with AI** to generate a suggestion or use your personal writing style.
3. Choose your channels, inspect the previews and edit each platform's version.
4. Select **Review posts** to check the text and media for each destination.
5. Open **Assisted**, copy or download the prepared content, and publish it on the destination platform.

### Platforms

| Workflow | Platforms |
| --- | --- |
| Dedicated draft versions and previews | LinkedIn, Threads, Bluesky, Mastodon |
| Assisted publishing | LinkedIn, Threads, Bluesky, Mastodon, X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit |

Assisted publishing prepares content; it does not sign in or publish for you. Calendar dates and reminders do not trigger automatic posts. An optional Mastodon integration supports text posting and confirmed scheduled tasks, but remains experimental. Bluesky account authorization is not available in the interface.

## Getting started

Requires **Node.js 24.14 or later within the 24.x release line**, and npm.

```sh
git clone https://github.com/Ir1svanquish/plypost.git
cd plypost
npm ci
```

Copy [`.env.example`](.env.example) to `.env.local`, then generate a password hash:

```sh
npm run hash-password
```

Set these values in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `PLYPOST_OWNER_EMAIL` | Email used to sign in to your workspace. |
| `PLYPOST_OWNER_PASSWORD_HASH` | Hash produced by `npm run hash-password`. |
| `NEBIUS_API_KEY` | Optional Token Factory key for AI features. |
| `PLYPOST_DB_PATH` | Optional database location; defaults to `data/plypost.sqlite`. |
| `PLYPOST_AI_DAILY_LIMIT` | Optional rolling 24-hour AI request cap, from 1 to 240. |

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in with your configured email and the password you chose. Keep `.env.local`, your database and exported backups private.

To explore a separate workspace with fictional sample content:

```sh
npm run demo
```

The demo creates its own database and writes its local login details to `data/demo/login.txt`. The hosted demo uses a separate account and requires access credentials.

## AI models

Plypost makes server-side requests to **Nebius Token Factory**, using its hosted NVIDIA models without a local inference server.

| Model | Tasks |
| --- | --- |
| `nvidia/nemotron-3-super-120b-a12b` | Drafting, platform adaptation, personal-style analysis, weekly ideas and source comparison |
| `nvidia/Nemotron-3.5-Super-VL` | Captions based on a user-selected image |

Generation runs when you request it. The app sends the content needed for that task, such as the selected text, image, style guide or brand brief. API keys stay on the server. Suggestions remain editable and do not publish automatically.

Source checks compare a rewrite with the supplied text; they do not verify facts on the web. Video files are stored for publishing preparation, but their frames are not analyzed by AI.

## Self-hosting

Run a single Node.js application instance with persistent storage for SQLite and media.

```sh
npm run build
npm start
```

Use HTTPS for a public installation, configure the same environment variables on the host, and point `PLYPOST_DB_PATH` to persistent storage. The health endpoint is `/api/health`.

An optional [Render Blueprint](render.yaml) provides a web service and persistent disk. It provisions paid resources. Leave social connection settings unset for the standard assisted-publishing workflow.

The optional scheduling worker runs separately with `npm run worker`. It must remain running to process queued simulations or explicitly confirmed Mastodon tasks; ordinary draft dates and manual reminders do not require it.

## Development

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## License

[MIT](LICENSE)
