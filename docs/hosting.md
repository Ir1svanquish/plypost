# Hosting the judging demo

Plypost currently runs on one Node.js process with a local SQLite database. A public judging copy needs its **own** database and owner account. Keep the local `data/` folder and `.env.local` off the host. Use HTTPS, set the Nebius key only in the host's server-side secret settings, and leave Bluesky/Mastodon connection settings unset. Do not run the worker for the judging demo. `GET /api/health` returns `200` only when the app can open its database; it does not reveal credentials or content.

## Low-cost choices

Prices and limits checked 2026-10-25; confirm them in the provider dashboard before creating a service.

| Option | Fit for this app | Cost and limitation |
| --- | --- | --- |
| [Render paid web service](https://render.com/docs/web-services) with a [persistent disk](https://render.com/docs/disks) | A single Node service, HTTPS address and a disk for SQLite. The smallest listed paid compute plan is [US$7/month](https://render.com/pricing); storage is listed at US$0.25/GB/month. | Straightforward first choice for the judging period. The disk allows one service instance and pauses the service briefly during deploys. The 512 MiB plan still needs a live memory check. |
| [Railway](https://docs.railway.com/overview/the-basics) with a [volume](https://docs.railway.com/volumes) | Also supports one service and persistent SQLite. The [Free tier](https://railway.com/pricing) currently lists 0.5 GB RAM and 0.5 GB volume; Hobby has a US$5 minimum monthly usage commitment. | Usage can exceed the included amount. The Free tier's small monthly credit is a poor basis for promising uninterrupted judging access; measure real usage before selecting it. |

Render's free web service cannot attach a persistent disk and can restart with an empty filesystem, so it is unsuitable for an editable demo that must survive until judging ends. See [Render's free-service limits](https://render.com/docs/free). These are hosting options, not services already created or paid for.

## Deployment shape

1. Connect a **copy of the repository** to the chosen host. Keep source visibility private until the separate contest requirement to publish code and add an open-source license has been reviewed.
2. Use Node.js 24.14+, `npm ci` and `npm run build`. Start one instance with `next start` listening on `0.0.0.0` and the host's `PORT`. Set health check path to `/api/health`.
3. Attach persistent storage before first start. Set `PLYPOST_DB_PATH` to a file inside that mount. On Render's native Node runtime, a disk mounted at `/opt/render/project/src/storage` can use `/opt/render/project/src/storage/plypost.sqlite`; on Railway, a volume mounted at `/app/data` can use `/app/data/plypost.sqlite`.
4. Set a dedicated `PLYPOST_OWNER_EMAIL`, a fresh `PLYPOST_OWNER_PASSWORD_HASH` and `NEBIUS_API_KEY` as server-side secrets. The random local demo password in `data/demo/login.txt` is not a hosted credential. Do not set `PLYPOST_LOCAL_DEMO_HTTP` on the host. Use the HTTPS address in judging instructions and provide the dedicated login details there.
5. Start without the background worker or social account keys. Create or import only fictional sample content, then check login, editing, Nebius generation, persistence after restart, mobile layout and `/api/health` from a network outside the host. Record the public URL only after these checks pass.

No cloud service or public URL has been created yet. Provider account connection, payment choice, open-source license and public repository visibility remain owner decisions.
