# Plypost

A responsive Next.js MVP for drafting one message, adapting it for Bluesky, Mastodon, LinkedIn and Threads, and reviewing each version before a **simulated** publishing run or a manual assisted publishing workflow.

## What works

- Write a source draft and select one to four destinations.
- Preview and edit a separate version for each platform. Local edits, selections and demo activity are saved in your browser.
- Save named drafts, reopen or update them, and export/import a JSON backup of the saved library and publishing plan.
- Add selected platform drafts to a dated local publishing plan. Due items can be run manually through the simulation endpoint; nothing executes automatically when the app is closed.
- Prepare assisted publishing checklists for X, Facebook Pages, Instagram, TikTok, YouTube, Pinterest, Reddit, and the original four platforms. Each item saves a text snapshot and an optional reminder time. Copy the text, open the platform, post there yourself, then mark the item posted. Plypost does not verify that mark.
- Due assisted items appear in the app. Browser alerts are optional and are sent only while this page is open after you click **Enable browser alerts** and grant permission.
- Ask a server-side Nebius Token Factory or NVIDIA Nemotron endpoint to create four tailored drafts. This is optional; the editor and simulation work without an API key.
- Run a server-side publishing simulation that validates nonempty text and platform character limits, then returns clearly labeled demo receipts. **No social platform API is called and nothing is posted.**
- Each platform has its own publishing adapter module under `src/lib/publishers`. The current adapters all use the simulation implementation, making real integrations an explicit future change.
- Use a responsive workspace with light, dark, or system appearance. The selection stays in this browser and follows system changes when set to **System**.

The saved library, publishing plan, and assisted publishing checklist live in this browser's local storage. Export a backup before clearing browser data or changing devices. Importing a backup replaces these saved lists after confirmation; it does not replace the current editor. Both publishing lists capture text snapshots, so later edits do not silently change them. Dates are entered in your device's local time. Version 2 backups remain importable.

Plypost keeps the earlier browser storage keys after the rename, so existing SocialFlow AI drafts and plans remain available. The source repository is [Ir1svanquish/plypost](https://github.com/Ir1svanquish/plypost).

## Assisted publishing

1. Write a draft, then go to **Assisted publishing**. Select a platform and edit the text to copy. For the original four platforms, the field starts with that platform's current draft.
2. Leave the reminder time blank for an item ready now, or choose a future local time. Add it to the checklist.
3. When ready, click **Copy text**, then **Open platform**. Paste and review it on the platform, add media where required, and publish from your own account.
4. Click **I posted it** only after you have posted it yourself. This is a self-reported local status, and **Undo mark** is available.

The open links go to the platforms' public websites; some require further navigation to the correct account, Page, community or composer. The text is **not** passed in those links. Instagram, TikTok, YouTube and Pinterest require you to add suitable media on the destination platform. Browser alerts require permission and do not run while the app or browser is closed; the due list remains visible when you return.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the staged development plan and acceptance criteria.

## Run locally

Requires Node.js 20.9 or later and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp` if needed.

The app works without editing `.env.local`. To use AI adaptation, fill in one provider:

| Variable | Purpose |
| --- | --- |
| `NVIDIA_API_KEY` | NVIDIA API Catalog key for Nemotron |
| `NVIDIA_MODEL` | Defaults to `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_API_KEY` | Nebius Token Factory key |
| `NEBIUS_MODEL` | Exact chat model ID available to your Nebius account |

Restart the development server after editing `.env.local`. Select the matching provider in the app and click **Generate variants**. The key is read by `src/app/api/generate/route.ts` on the server and is never sent to the browser. The endpoint URL is fixed in server code; visitors cannot supply an arbitrary URL. The `.env*` ignore rule excludes real environment files while keeping `.env.example` in Git.

Provider references: [Nebius OpenAI-compatible API](https://api.tokenfactory.nebius.com/docs) and [NVIDIA Nemotron API example](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b).

## Checks

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm audit
```

`npm test` starts the production build locally and exercises the page, validation errors, missing-key behavior, and successful simulated publishing. Run `npm run build` first.

## Scope and next steps

This MVP has no account login, OAuth connections, automatic posting, uploads or database. Assisted publishing hands the final posting action to the user; it does not claim that a post was sent. The displayed character limits are useful draft checks; Mastodon limits can vary by instance, and every live platform integration should validate against its current API rules. Before hosting the AI endpoint publicly, add user authentication and rate limiting to control key usage. Real publishing adapters should use each platform's official OAuth flow and API, store credentials server-side, and report partial failures per destination.
