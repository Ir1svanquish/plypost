# Competition submission draft

This file is a review draft, not a submitted entry. Keep the judge password and API key out of Git, video captions, and screenshots. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) require an English submission, a working demo, a public licensed repository, and a public YouTube video under three minutes.

## Devpost fields

**Project:** Plypost

**Tagline:** Turn one idea into platform-ready posts, with AI suggestions that stay under your control.

**Track:** Best Apps and Agents

**Demo:** https://plypost.onrender.com/

**Source:** https://github.com/Ir1svanquish/plypost (public, MIT licensed).

**Video:** Add the public YouTube URL after upload.

### What it does

Writing for several social platforms usually means copying the same draft into separate editors, adjusting the wording and media, then remembering what still needs to be posted. Plypost keeps that work together. A creator can write one source draft, attach images or a short video, create distinct versions for LinkedIn, Threads, Bluesky, and Mastodon, and review each version before preparing a manual publishing checklist. Other common networks have manual handoff forms. Drafts, media, reminders, and handoff status are stored in a persistent workspace. The app does not claim to publish to every network automatically.

Plypost uses Nebius Token Factory at runtime for optional AI assistance. NVIDIA Nemotron 3 Super proposes platform versions and a weekly plan from a brand brief. It can also compare an edited post with its source and flag details that may have drifted. NVIDIA Nemotron 3.5 Super VL drafts a caption from an image the user selects. A creator can build a personal writing guide from old posts they explicitly select; the original posts are not kept. Every AI suggestion remains editable and must be accepted by a person. The API key stays on the server, and no post is sent to a social network by these AI actions.

The product is aimed at an individual creator or a small team that needs a practical review and handoff process without handing an AI system control of its social accounts. The distinction is the path from one idea to reviewed platform versions and a clear manual posting queue, with AI placed inside that path rather than as a separate chat box.

### How Nebius and NVIDIA are used

The Next.js server calls Nebius Token Factory's chat completions API when the user requests a generation or check. Text tasks use `nvidia/nemotron-3-super-120b-a12b`; the selected-image caption task uses `nvidia/Nemotron-3.5-Super-VL`. The app sends only the content needed for the chosen action, parses the returned suggestion, and puts it in an editable review step. The hosted demo runs on Render, while model inference runs on Nebius Token Factory.

### Feedback draft — review before submitting

Token Factory gave us access to Nemotron text and vision models through the same chat completions API. Both returned usable results in our tests, which made it straightforward to put writing and image captioning in one editor. We also saw a text rewrite change “is testing” to “tested.” That small tense shift could make a public post misleading, so Plypost now asks the model to preserve the status of work and leaves every suggestion unchecked for review. A model-specific example for preserving planned, ongoing, and unverified claims in short rewrites would help. Clearer guidance on vision input size and output limits would also help developers build reliable image workflows. The entrant should edit this draft to match their own experience before submitting it.

## Private judging instructions

Put the dedicated demo email and password in Devpost's testing instructions, not in this file or the public repository. The owner confirmed on October 28 that the hosted account contains only fictional data and is intended for judges to share. A shared login lets judges see and edit the same workspace; back up or reset sample content before judging, and do not reuse a personal password. Keep the service available free of charge through the judging period, which ends December 15, 2026 at noon Pacific Time (December 16 at 04:00 in Hong Kong).

1. Open https://plypost.onrender.com/ and sign in with the dedicated credentials supplied privately in Devpost.
2. Open **Create**. Enter a fictional post or open a saved example from **Drafts**. Add an image if testing the vision flow.
3. Choose two platforms. Open **Generate caption** to try a writing style, or request platform versions. Review and edit suggestions before applying them. Model calls share a per-account hourly limit and the hosted service may also have a daily cap.
4. Open **Review posts**. Inspect the separate platform text and image choices, then create an **Assisted** handoff. This prepares a checklist; it does not post to a social account.
5. Open **Plan** to see target dates and reminders. Any simulation shown there is a simulation, not a real network post.

For troubleshooting, `GET /api/health` should return `{"status":"ok"}`. The judge account does not need a connected Bluesky or Mastodon account to test the main workflow.

## Video plan, 2 minutes 30 seconds

Record the working application on a desktop browser. Use only fictional text and a synthetic or self-owned image. Do not show credentials, API keys, private browser tabs, or a real social account. Capture real clicks and model responses; do not substitute mock results. Add English narration or English captions.

| Time | Show on screen | Narration point |
| --- | --- | --- |
| 0:00–0:15 | Login complete; Create page | One idea usually turns into several slightly different posts. |
| 0:15–0:40 | Type a short fictional draft and attach a sample image | The source and media stay together in one workspace. |
| 0:40–1:10 | Open Generate caption; select the image and generate; edit the suggestion | Nemotron 3.5 Super VL proposes a caption; the user keeps control of the text. |
| 1:10–1:40 | Select LinkedIn and Threads; request platform versions, edit one suggestion and apply only that version | Nemotron 3 Super drafts versions through Nebius Token Factory; suggestions begin unchecked. |
| 1:40–2:05 | Review posts; correct a detail and choose images per platform | The review step catches differences before a handoff is prepared. |
| 2:05–2:25 | Open Assisted and Plan | Posting stays manual; dates and handoff status remain visible. |
| 2:25–2:30 | End card with demo and source URLs | Invite judges to test the hosted demo. |

Do a test recording first. If a live model call is slow, trim waiting time in the edit while preserving the real request and response. Verify the final video is under three minutes and publicly viewable on YouTube before adding its URL to Devpost.

## Release gate

- [x] Hosted site and health endpoint respond; `/api/health` returned 200 on October 28.
- [x] Render shows reviewed application commit `18e7768c0c4fc1bb1a6a17d48a26cf9082352ab3` as Live. The hosted page and `/api/health` both returned HTTP 200 on October 28; later documentation-only commits do not change the deployed application.
- [x] MIT license and local setup instructions are in the repository.
- [x] Known-format credential prefixes and sensitive filenames were checked in the current reachable Git history; no match was found. This is not a guarantee against every secret format.
- [x] On 2026-10-28, unauthenticated requests to the hosted drafts, media, videos, backup, AI style, brand brief and account-connection endpoints returned HTTP 401.
- [ ] Project owner reviews logo and sample-media provenance, and the public repository contents.
- [x] GitHub repository is public; an unauthenticated request returned HTTP 200 for the repository and its MIT license on 2026-10-26.
- [x] The owner confirmed that the hosted judge workspace contains only fictional data and may be shared with judges.
- [ ] Dedicated judge credentials are supplied privately in Devpost and the final login flow is checked.
- [ ] Actual-use video is recorded, checked, and made publicly visible on YouTube.
- [ ] English submission fields and feedback are reviewed and entered in Devpost before the deadline.

The production dependency audit currently reports 15 high-severity paths tied to Zod 3 in the optional Bluesky OAuth dependency chain. The hosted judging demo does not need a Bluesky connection; leave that integration unconfigured until the dependency can be updated compatibly and retested.
