# Local demo

This demo uses a separate SQLite database and a fictional brand. It never connects a social account or sends a post. The one item marked posted is an example of a **manual status update**, not a real publication. The calendar job is a simulation.

From the repository root, with Node.js 24.14+ and dependencies installed:

```powershell
npm install
npm run demo
```

Open `http://127.0.0.1:3187` and sign in with the random credentials in `data/demo/login.txt`. To use another port, run `npm run demo -- --port 3201`. The demo binds to this computer's loopback address. The script creates `data/demo/` only once and refuses to replace it. The directory is Git-ignored. Do not publish its login file or database.

To inspect the compiled test build with the same isolated demo data, run `npm run build` followed by `npm run demo:test-build`. You can choose a port with `npm run demo:test-build -- --port 3201`. This runs `next start` on the loopback address and permits an HTTP session cookie only for this script's local demo. Public hosting still needs HTTPS and its own server-side credentials. Rebuild after changing source code.

Try the flow: open **Create** to inspect platform-specific versions, **Drafts** to see two planned ideas and their handoff progress, **Plan** to see the reminder and simulated slot, and **Assisted** to review the manual publishing checklist. No worker is needed to browse the seeded data. You can edit the fixtures freely; future demo starts reuse your local edits.

For the live AI part, configure `NEBIUS_API_KEY` in the ignored `.env.local`, restart the demo, and click **Generate variants** on a draft or **Make a weekly plan** in Strategy. The default model is NVIDIA Nemotron 3 Super through Nebius Token Factory. Only the text or fictional brand brief you explicitly submit goes to that service. The seeded data itself was written locally and does not represent an AI response.

This command is for local review. It does not provide a public judging URL or a hosted service. A public demo needs its own isolated database, credentials and server-side key, plus a separate deployment and access check.
