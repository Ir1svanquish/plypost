# Plypost

[MIT License](LICENSE)

## For judges

Plypost is a web workspace for turning one idea into posts tailored for several social platforms. Write a draft, attach images or a short video, review each platform's wording, and prepare a manual publishing checklist. Drafts and media remain in the app's SQLite workspace. The assisted handoff does not post on your behalf.

The optional AI tools make runtime calls to Nebius Token Factory. NVIDIA Nemotron 3 Super drafts platform versions, suggests a weekly plan from a brand brief, and checks a proposed post against its source text. NVIDIA Nemotron 3.5 Super VL can draft a caption from one image the user selects. Suggestions stay editable and require a person to accept them. AI requests and credentials are handled on the server.

[Hosted demo](https://plypost.onrender.com/) · [Local setup](#本机运行) · [English judging and submission draft](docs/submission.md). The hosted demo requires a separate judge login supplied in the private Devpost testing instructions; no credentials are stored in this repository.

### Local setup in English

Use Node.js 24.14 or newer within major version 24. Run `npm ci`, copy `.env.example` to `.env.local`, and run `npm run hash-password`. Put the chosen email and the generated password hash in `PLYPOST_OWNER_EMAIL` and `PLYPOST_OWNER_PASSWORD_HASH` in `.env.local`; add `NEBIUS_API_KEY` only if you want to call the AI models. Start with `npm run dev` and open `http://localhost:3000`. Keep `.env.local` and `data/` private. For a fictional, separate workspace without social account connections, run `npm run demo` and read the generated login details in the ignored `data/demo/login.txt`. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` to check the project.

Plypost 是一个多平台发帖工作台。写一份草稿，再按平台改文案、存图片、设提醒。可在本机运行；[公开演示站](https://plypost.onrender.com/)由单实例 Render 服务托管，GitHub 更新需要手动部署。该服务使用持久磁盘保存 SQLite 数据，每次部署会短暂中断访问；详见[托管说明](docs/hosting.md)。

新草稿从空白开始，不预选平台。写帖页在正文框内用 **＋** 添加图片或视频；选中的图片缩略图和视频标记会留在正文下方，可直接移除。正文下方的工具栏可插入表情、话题符号，填写地点备注，或打开目标日期。地点只是人工发布时的提示，不读取定位，也不会自动添加平台地理标签。图片缩略图仍只对登录账号可见，下载原图不受影响。正文下方展开 **Generate caption** 选写法；其它选项按需展开。可以只存标题或素材，稍后再补文案。

若保存时服务中断，写帖页会保留编辑内容并显示 **Check save**。连接恢复后点击它，应用会先核对服务器里的草稿，再决定是否重试，避免重复保存。若原标签页已经关闭，可在新标签页的 **Create** 展开“recoverable browser copy”，打开原稿后再点 **Check save**。原副本仍留在这个浏览器；确认已保存后，可逐份选择 **Remove copy** 清理。核对前不要清除本站的浏览器数据；此流程依赖浏览器本地存储。

桌面端点击侧栏里的 Plypost 标识可收起或展开导航；窄屏点击页首标识可打开导航抽屉。

## 现在能做什么

- 为 Bluesky、Mastodon、LinkedIn、Threads 保存不同版本的文案和预览。草稿最多附 20 张图片和一段视频；准备人工发布待办时，可为每个平台单独选择图片及上传顺序，图片说明会跟着所选图片走。Bluesky、X 和 Mastodon 先按 4 张处理，LinkedIn、Threads 最多选 20 张；Threads 若同时附视频，最多再选 19 张图片。Mastodon 的实际限制以账号所在服务器为准。也可以先存标题或素材，发布前再补文案。
- 为上述平台以及 X、Facebook Pages、Instagram、TikTok、YouTube、Pinterest、Reddit 建立人工发布清单。平台按图文优先、视频优先分组；可以逐平台改文案，保存图片或短视频，并下载包含文案和素材的发布包。批量审核时可逐平台决定是否附带同一段视频；每条未发布待办都能单独调整图片、说明和视频，不影响原草稿或其他待办。若一条待办同时有图片和视频，审核页及下载包会提醒核对目标平台是否允许混用。发帖仍由你在目标平台完成。
- Mastodon 和 LinkedIn 若选择带视频的人工交接，默认只带视频；草稿图片仍在，可改成图片帖，或在核对所用客户端后手动加入。标准 Mastodon 网页端可能不显示混合帖里的图片，LinkedIn 的照片与视频入口分开。
- 写帖页点选平台后才能编辑其专属版本，示意预览可按需展开。点 **Review posts** 会先保存当前草稿，再打开逐平台审核；这里可补选草稿未勾选的 LinkedIn、Threads、Bluesky 或 Mastodon，以正文为起点单独改稿，选图片并调整顺序，审核后才建立人工发布待办，不改写原草稿。批量审核会提示缺少的图片或视频；YouTube、TikTok 等单平台入口也可选图并打开单条人工发布表单。
- 草稿库可搜索标题和文案，按未选平台、已选平台或附带视频筛选，并按最近修改或目标日期查看；没有目标日期的草稿排在目标日列表末尾。每张草稿卡会显示关联的人工发布待办与手动标记的发布数；有正文时可直接进入发布准备。
- 新建人工发布待办时，图文和视频分组只用于浏览平台；点选具体平台才会切换目标。每个平台正在编辑的临时文案会保留，也能单独恢复为当前草稿文案；加入清单后才会保存。
- 草稿可设一个目标日期，方便在计划日历里看到还没完成的内容。计划页也列出尚无目标日期的草稿，可直接设定日期；日历中的日期可移动或清除。目标日期只用于规划，不会创建提醒或自动发布。人工待办另设提醒。日历里的模拟发布也不会向平台发帖。
- 在日历中的草稿可以直接进入逐平台人工发布准备。日历会显示同一草稿已有多少条人工待办，以及目标日是否已经过去；点击“Prepare handoffs”仍需逐平台检查并确认，不会直接发帖。
- 批量准备时若不填写提醒时间，待办只留在 Assisted 清单，不会被计入到期提醒或出现在日期日历。旧版已保存的待办仍按其原记录显示，可逐条移除不需要的提醒。
- 发布后可手动记录浏览量、点赞、回复和备注。计划页汇总最近录入的单篇结果，可打开原记录，或从已发布文案开始一篇未保存的新草稿。指标和备注由你录入，Plypost 不验证、不用于 AI 周计划，也不跨平台排名；若后来对草稿手动点击 AI 文案改写，草稿文字会按该功能的提示发送。
- 配置 Nebius Token Factory 后，可用其托管的 NVIDIA Nemotron 3 Super 手动生成逐平台文案和一周选题。不配置也能使用草稿和人工发布功能。已选平台只生成对应版本；未选平台时可先看四个平台的建议，审核时不会预先勾选。逐平台建议可在审核区对照、直接修改，并检查字数；空白或超出平台限制的选中版本不能应用。只有勾选并应用的版本才替换编辑器内容。一周选题也须经人审阅后才能变成草稿。
- **Generate caption** 提供默认、个人风格，以及简短直述、实用要点、对话提问、幕后过程、小故事五种写法。个人风格须先手动选 3–6 篇旧帖分析；只保存提炼出的风格指南，原帖不入库。可手动改或删除指南；另一窗口修改了指南时，当前编辑会保留文字并要求先核对新版本。有图片时可选一张交给 NVIDIA Nemotron 3.5 Super VL 看图起稿；有文字时会把正文当作背景说明。只有视频时须先写文字说明，AI 不读取视频帧。建议先核对和编辑，点击采用后才替换正文；已附素材保留。逐平台改写仍在同一面板里。
- Facebook、Instagram、X、Reddit、Pinterest、YouTube、TikTok 的人工发布文案框可点 **Adapt with AI** 请求单平台建议。只发送当前框里的文字，不发送已附图片、视频或手填的发帖结果；建议可编辑，须手动采用后才会替换文案。它只准备人工待办，不会替你发帖；各平台的最终字数和素材要求仍要在目标平台确认。
- AI 改写建议和逐平台人工发布文案会在本机对照原文的数字、星期、上午／下午标记、链接、邮箱和标签。主编辑器中这些细节有增减的建议默认不勾选；在审核区手动改出差异时也会取消该版本的勾选，须核对后自行重选。人工发布审核也会提示字面差异。这不能代替事实核查。
- 逐平台人工发布审核中可点 **Check with AI**，让 Nemotron 对照保存的草稿正文与当前平台文案，指出可能新增或改动的细节以及容易误解的句子。只在点击时发送这两段文字和目标平台，不发送素材或发帖结果；报告不会修改文案，文案变化后旧报告会标记为过期。模型不联网核实事实，空报告也不代表内容准确。

写法选项参考了 [TikTok 的 2026 趋势报告](https://ads.tiktok.com/business/en-US/next)对真实过程和幕后内容的观察、[Buffer 的 2026 平台数据](https://buffer.com/resources/state-of-social-media-engagement-2026/)对互动的分析，以及 [LinkedIn 的内容建议](https://business.linkedin.com/marketing-solutions/strategy-guides/linkedin-marketing-tactical-plan)中对实用观点的强调。它们是编辑方式，不是实时热词或效果排名；模型不能凭风格选项编出经历或结果。

另有 Bluesky 和 Mastodon 的纯文字发帖入口，以及 Mastodon 的本机定时队列。这些入口**尚未经过真实账号验收**。定时队列依赖本机 worker；电脑休眠或进程关闭时不会准时执行。图片目前只用于人工发布。

短视频可随草稿保存，并带入人工发布待办；不会随模拟或纯文字直发上传。支持 MP4、WebM、MOV，单个不超过 32 MiB，本机视频库最多 12 个、共 64 MiB。选中视频后可在浏览器里播放检查；浏览器不能解码时仍可下载原文件。应用按原样保存视频，不转码或清除元数据，也不保证目标平台接受该文件。**Account → Backup and restore → Download full backup** 包含草稿引用的图片、视频和已保存的写作风格指南，上限 192 MiB；普通文本 JSON 不含素材文件。恢复前会确认替换已保存内容；未保存的编辑内容也会被丢弃。备份里有私有内容，请妥善保管。

人工发布时，时间留空会加入无提醒清单，不触发到期通知，也不占据日历日期；之后可为这条待办添加、修改或移除提醒。“Due now”只表示已设置的提醒时间到了。YouTube 没有附视频，或 Instagram、TikTok、Pinterest 没有附图片或视频时，清单会提示你在发布前补上素材。

YouTube 视频交接默认只带视频，不把草稿图片当作视频帖素材。可以手动选一张图片作为封面参考；自定义封面是否可用取决于 YouTube 账号验证及平台要求。

## 本机运行

需要 Node.js 24.14 或更新的 24.x 版本，以及 npm。在 PowerShell 中：

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run hash-password
```

把邮箱和命令输出的密码哈希填入 `.env.local` 的 `PLYPOST_OWNER_EMAIL`、`PLYPOST_OWNER_PASSWORD_HASH`，然后运行 `npm run dev`，打开 [http://localhost:3000](http://localhost:3000)。

登录不会因连续输错而锁定；同时校验请求过多时会立即提示稍后重试，空闲后可直接登录。公开演示账号务必使用强随机密码。登录请求仍限制为 4 KiB。
更换 `PLYPOST_OWNER_PASSWORD_HASH` 后，先前的登录会话会失效，需要用新密码重新登录。Render 演示站在 **Environment** 中替换该变量并部署；新哈希可在本机运行 `npm run hash-password` 生成，命令不会显示输入的明文密码。

需要处理到期的模拟任务或已确认的 Mastodon 定时任务时，另开一个终端运行 `npm run worker`。数据默认存于 `data/plypost.sqlite`；请保管好数据库和导出的备份。`.env.local` 与 `data/` 不会提交到 Git。

## 可选配置

| 功能 | 配置 |
| --- | --- |
| AI 写作 | 统一使用 Nebius Token Factory 和 `NEBIUS_API_KEY`。文字任务用 `nvidia/nemotron-3-super-120b-a12b`；图片起稿用 `nvidia/Nemotron-3.5-Super-VL`。点击生成文案只发送当前正文；若选了图片，则另发送明确选中的一张图片；选个人风格时加上已保存的风格指南。视频文件不会发送给模型。手动分析旧帖会发送选中的文字；逐平台改写会发送当前草稿及选中的个人风格指南；人工发布文案旁的改写只发送该框文字与目标平台；逐平台 AI 检查会发送保存的草稿正文、当前平台文案和目标平台；生成周计划只发送品牌资料，不发送发帖结果。密钥只留在服务端。 |
| AI 调用额度 | 每个账号每小时最多请求 10 次，所有 AI 功能共用额度，记录存在 SQLite 中。公开演示可额外设置 `PLYPOST_AI_DAILY_LIMIT`（1–240）限制滚动 24 小时内的总请求；留空则只用每小时限制。这不是 Nebius 账户的费用上限。 |
| Bluesky 账号 | 填写 `PLYPOST_BLUESKY_ORIGIN` 和 `PLYPOST_BLUESKY_SECRET`，然后在 **Account** 中连接。浏览器地址须与配置一致。 |
| Mastodon 账号 | 有账号时再填写 `PLYPOST_MASTODON_INSTANCE`、`PLYPOST_PUBLIC_ORIGIN` 和 `PLYPOST_MASTODON_SECRET`。可用 `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` 暂停新的定时任务和后续派发，改动后须重启应用与 worker。 |

两个 `*_SECRET` 应分别使用独立的 32 字节随机密钥。具体格式见 [.env.example](.env.example)。恢复备份不会取消本机已经排入真实发布队列的 Mastodon 帖子。

配置好 Nebius 密钥后，可选运行 `npm run smoke:nebius`：它用固定样例文案和虚构品牌资料做两次模型调用，检查四个平台版本和周计划，不会读取本机草稿或品牌资料。密钥和输出不会写入仓库。

`npm run smoke:vision` 用程序生成的纯色图片检查视觉模型调用及返回格式，不读取或上传你的图片。

不想用自己的草稿演示时，运行 `npm run demo`，用独立的虚构数据库查看草稿、排程与人工发布流程。登录信息生成在 Git 忽略的 `data/demo/login.txt`。生产构建也可用 `npm run build`、`npm run demo:test-build` 检查。操作步骤与 AI 实时演示条件见[本机演示说明](docs/demo.md)。

## 检查

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

公开演示站的首页和 `/api/health` 已从外部网络返回 200；新密码登录及会话接口已在该实例返回 200。虚构文案的单平台改写、双平台改写和合成图片的看图起稿也已在该实例返回可用结果。另用虚构文字草稿验证了 Render 服务重启后的保存与读取，并在验证后删除测试草稿。虚构图片和短视频也已通过重启后的逐字节读取检查，测试素材随后删除。线上还验收了单个 32 MiB 视频、接近 5 MiB 的图片，以及两条 32 MiB 视频同时上传；测试文件已清理。长期负载和更多并发仍待验证。Nebius × NVIDIA 大赛的技术路径、验证记录和未完成的提交材料见[参赛准备](docs/hackathon.md)。截至 2026-10-27，`npm audit --omit=dev --audit-level=high` 报出 15 条高危依赖路径，均源于 Bluesky OAuth 依赖所用的 Zod 3 与[同一项安全公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)；该依赖仍要求 Zod 3，不能靠强制覆盖为 Zod 4 来安全消除告警。公开启用 Bluesky 登录前须重新评估或等待兼容修复。下一步见[开发计划](DEVELOPMENT_PLAN.md)，各平台的接入门槛见[平台笔记](docs/platforms.md)。

草稿保存中断后的核对流程已在隔离演示中用丢失响应和一次读取失败验证；Render 当前部署的版本也已检查健康接口、界面资源和登录会话。此检查没有在公开站故意制造服务故障。

演示站的持久存储和上线验收步骤见[托管方案](docs/hosting.md)。

仓库另备有可选的 [Render Blueprint](render.yaml)，用于重建单实例、持久磁盘的评委演示。当前线上服务是手动创建的，尚未通过该 Blueprint 重建。
