# Hosting the judging demo

Plypost currently runs on one Node.js process with a local SQLite database. A public judging copy needs its **own** database and owner account. Keep the local `data/` folder and `.env.local` off the host. Use HTTPS, set the Nebius key only in the host's server-side secret settings, and leave Bluesky/Mastodon connection settings unset. Do not run the worker for the judging demo. `GET /api/health` returns `200` only when the app can open its database; it does not reveal credentials or content.

The AI routes require an owner session and allow ten requests per hour. They now stop oversized request bodies while reading them, before charging that allowance or calling the model. This limits accidental abuse of a shared judging login; it is not a spending cap for the Nebius account.

## Using your own VPS

A VPS can replace Render. It needs a stable public address, enough memory to build and run Node.js 24, persistent storage, and inbound ports 80/443. You do not need to buy a domain: a free DNS name such as a [DuckDNS subdomain](https://www.duckdns.org/) can point at the VPS. Prefer a stable name with automatically renewed HTTPS over publishing a bare HTTP IP address; production login cookies require HTTPS. The supplied Render Blueprint is not used on the VPS.

Run one `next start` process bound to loopback behind an HTTPS reverse proxy, and keep it running with the VPS service manager. Next.js [recommends a reverse proxy](https://nextjs.org/docs/app/guides/self-hosting); [Caddy](https://caddyserver.com/docs/automatic-https) can manage certificates for a public DNS name. Use a dedicated service account, a separate SQLite path on persistent storage, a fresh owner password hash, and server-only Nebius credentials. Keep `.env.local`, the database and judge login details out of Git. Do not start the publishing worker for the judging copy. Download a full backup through Plypost before deployment changes; images and videos are stored in its SQLite database. Then verify `/api/health`, login, an AI call and data after a restart from outside the VPS.

The exact install commands depend on the VPS operating system, memory, and whether it already runs a proxy. No VPS has been accessed or deployed by this project. A local production-server check accepted an HTTPS `Origin` forwarded through an HTTP proxy path and rejected a different origin; this is not a substitute for checking the actual VPS proxy.

## Low-cost choices

Prices and limits checked 2026-10-25; confirm them in the provider dashboard before creating a service.

| Option | Fit for this app | Cost and limitation |
| --- | --- | --- |
| [Render paid web service](https://render.com/docs/web-services) with a [persistent disk](https://render.com/docs/disks) | A single Node service, HTTPS address and a disk for SQLite. The smallest listed paid compute plan is [US$7/month](https://render.com/pricing); storage is listed at US$0.25/GB/month. | Straightforward first choice for the judging period. The disk allows one service instance and pauses the service briefly during deploys. The 512 MiB plan still needs a live memory check. |
| [Railway](https://docs.railway.com/overview/the-basics) with a [volume](https://docs.railway.com/volumes) | Also supports one service and persistent SQLite. The [Free tier](https://railway.com/pricing) currently lists 0.5 GB RAM and 0.5 GB volume; Hobby has a US$5 minimum monthly usage commitment. | Usage can exceed the included amount. The Free tier's small monthly credit is a poor basis for promising uninterrupted judging access; measure real usage before selecting it. |

Render's free web service cannot attach a persistent disk and can restart with an empty filesystem, so it is unsuitable for an editable demo that must survive until judging ends. See [Render's free-service limits](https://render.com/docs/free). These are hosting options, not services already created or paid for.

## Prepared Render setup

The repository includes [`render.yaml`](../render.yaml) for an optional judging copy. It specifies one Starter web service in Singapore, a 1 GB persistent disk for SQLite, `/api/health`, and manual deploys after the first deployment. The service uses `npm ci && npm run build` and `npm start`; Next.js reads Render's `PORT` environment variable. The Node engine range is limited to Node 24 so a future major release cannot be selected silently.

The Blueprint prompts for a dedicated owner email, password hash and Nebius key when it is first created. Their values are absent from Git. Render does not re-prompt for `sync: false` values on later Blueprint updates, so rotate or replace them in the service settings. The Blueprint turns Mastodon scheduling off and does not start a worker. A disk-backed service uses a paid plan; merely keeping this file in Git does not create a service. The Blueprint has not been validated against a Render account or deployed there.

Local checks on 2026-10-25: `render.yaml` passes [Render's published JSON Schema](https://render.com/docs/blueprint-spec#validating-blueprints). With a separate fictional SQLite database, `npm start` picked up `PORT`, served `/api/health`, accepted the demo login, and returned the saved workspace. A new test draft remained available after stopping and restarting the production server. This checks the app's single-process deployment shape; it does not measure Render's memory limit or prove the hosted service works.

## Deployment shape

1. Connect the repository to the chosen host only after reviewing its requested GitHub access and cost. Keep source visibility private until the public-release review. The repository includes an MIT license.
2. Use Node.js 24.14.x or newer within major version 24, `npm ci` and `npm run build`. Start one instance with `next start` listening on `0.0.0.0` and the host's `PORT`. Set health check path to `/api/health`.
3. Attach persistent storage before first start. Set `PLYPOST_DB_PATH` to a file inside that mount. On Render's native Node runtime, a disk mounted at `/opt/render/project/src/storage` can use `/opt/render/project/src/storage/plypost.sqlite`; on Railway, a volume mounted at `/app/data` can use `/app/data/plypost.sqlite`.
4. Set a dedicated `PLYPOST_OWNER_EMAIL`, a fresh `PLYPOST_OWNER_PASSWORD_HASH` and `NEBIUS_API_KEY` as server-side secrets. The random local demo password in `data/demo/login.txt` is not a hosted credential. Do not set `PLYPOST_LOCAL_DEMO_HTTP` on the host. Use the HTTPS address in judging instructions and provide the dedicated login details there.
5. Start without the background worker or social account keys. Create or import only fictional sample content, then check login, editing, Nebius generation, persistence after restart, mobile layout and `/api/health` from a network outside the host. Record the public URL only after these checks pass.

No cloud service or public URL has been created yet. Provider account connection, payment choice and public repository visibility remain owner decisions. The owner selected MIT for the source license.
