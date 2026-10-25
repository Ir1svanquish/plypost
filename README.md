# Plypost

[MIT License](LICENSE)

Plypost 是一个多平台发帖工作台。写一份草稿，再按平台改文案、存图片、设提醒。可在本机运行；[公开演示站](https://plypost.onrender.com/)由单实例 Render 服务托管，GitHub 更新需要手动部署。

新草稿从空白开始，不预选平台。写帖页先显示正文、AI 生成和平台选择；素材、草稿信息、其它平台与模拟入口按需展开。可以只存标题或素材，稍后再补文案。未手动命名的草稿会随正文首行更新名称。

桌面端点击侧栏里的 Plypost 标识可收起或展开导航；窄屏点击页首标识可打开导航抽屉。

## 现在能做什么

- 为 Bluesky、Mastodon、LinkedIn、Threads 保存不同版本的文案和预览。草稿最多附四张图片和一段视频；也可以先存标题或素材，发布前再补文案。
- 为上述平台以及 X、Facebook Pages、Instagram、TikTok、YouTube、Pinterest、Reddit 建立人工发布清单。平台按图文优先、视频优先分组；可以逐平台改文案，保存图片或短视频，并下载包含文案和素材的发布包。同一段视频可附到一批不同平台的待办；每条未发布待办都能单独调整图片、说明和视频，不影响原草稿或其他待办。发帖仍由你在目标平台完成。
- 写帖页点选平台后才能编辑其专属版本，示意预览可按需展开。点 **Review posts** 会先保存当前草稿，再打开逐平台审核；确认后才建立人工发布待办。批量审核会提示缺少的图片或视频；YouTube、TikTok 等单平台入口仍可打开单条人工发布表单。
- 草稿库可搜索标题和文案，按已选平台或附带视频筛选，并按最近修改或目标日期查看；没有目标日期的草稿排在目标日列表末尾。每张草稿卡会显示关联的人工发布待办与手动标记的发布数，也能直接进入发布准备或打开待办。
- 新建人工发布待办时，图文和视频分组只用于浏览平台；点选具体平台才会切换目标。每个平台正在编辑的临时文案会保留，也能单独恢复为当前草稿文案；加入清单后才会保存。
- 草稿可设一个目标日期，方便在计划日历里看到还没完成的内容。计划页也列出尚无目标日期的草稿，可直接设定日期；日历中的日期可移动或清除。目标日期只用于规划，不会创建提醒或自动发布。人工待办另设提醒。日历里的模拟发布也不会向平台发帖。
- 在日历中的草稿可以直接进入逐平台人工发布准备。日历会显示同一草稿已有多少条人工待办，以及目标日是否已经过去；点击“Prepare handoffs”仍需逐平台检查并确认，不会直接发帖。
- 批量准备时若不填写提醒时间，待办只留在 Assisted 清单，不会被计入到期提醒或出现在日期日历。旧版已保存的待办仍按其原记录显示，可逐条移除不需要的提醒。
- 发布后可手动记录浏览量、点赞、回复和备注。计划页汇总最近录入的单篇结果，可打开原记录，或从已发布文案开始一篇未保存的新草稿。指标和备注由你录入，Plypost 不验证、不用于 AI 周计划，也不跨平台排名；若后来对草稿手动点击 AI 文案改写，草稿文字会按该功能的提示发送。
- 配置 Nebius Token Factory 后，可用其托管的 NVIDIA Nemotron 3 Super 手动生成逐平台文案和一周选题。不配置也能使用草稿和人工发布功能。已选平台只生成对应版本；未选平台时可先看四个平台的建议，审核时不会预先勾选。逐平台文案会先标出有无改动，展开后标出替换与新增的片段；只有勾选并应用的版本才替换编辑器内容。一周选题也须经人审阅后才能变成草稿。
- 写帖页正文下方的 **AI writing** 可改写逐平台文案，也可分析你手动粘贴的 3–6 篇旧帖，保存提炼出的写作风格；旧帖原文不存进数据库。风格指南可手动修改或删除，修改不会再次调用 AI。点 **Write from photo** 可展开图片起稿，用 NVIDIA Nemotron 3.5 Super VL 分析指定的一张图片；图片从下方 **Photos or video** 添加。先核对模型观察，再编辑文案并加入草稿。加入前会检查草稿长度，图片或背景说明改变后须重新生成。每项 AI 操作都要手动点击，不会自动发布。
- Facebook、Instagram、X、Reddit、Pinterest、YouTube、TikTok 的人工发布文案框可点 **Adapt with AI** 请求单平台建议。只发送当前框里的文字，不发送已附图片、视频或手填的发帖结果；建议可编辑，须手动采用后才会替换文案。它只准备人工待办，不会替你发帖；各平台的最终字数和素材要求仍要在目标平台确认。
- AI 改写建议会在本机对照原文的数字、星期、上午／下午标记、链接、邮箱和标签。主编辑器中这些细节有增减的建议默认不勾选，须展开提醒核对后自行选择；人工发布文案也会显示相同提醒。这是字面差异提示，不能代替事实核查。

另有 Bluesky 和 Mastodon 的纯文字发帖入口，以及 Mastodon 的本机定时队列。这些入口**尚未经过真实账号验收**。定时队列依赖本机 worker；电脑休眠或进程关闭时不会准时执行。图片目前只用于人工发布。

短视频可随草稿保存，并带入人工发布待办；不会随模拟或纯文字直发上传。支持 MP4、WebM、MOV，单个不超过 32 MiB，本机视频库最多 12 个、共 64 MiB。选中视频后可在浏览器里播放检查；浏览器不能解码时仍可下载原文件。应用按原样保存视频，不转码或清除元数据，也不保证目标平台接受该文件。**Download full backup** 包含草稿引用的图片、视频和已保存的写作风格指南，上限 192 MiB；普通文本 JSON 不含素材文件。备份里有私有内容，请妥善保管。

人工发布时，时间留空会加入无提醒清单，不触发到期通知，也不占据日历日期；之后可为这条待办添加、修改或移除提醒。“Due now”只表示已设置的提醒时间到了。YouTube 没有附视频，或 Instagram、TikTok、Pinterest 没有附图片或视频时，清单会提示你在发布前补上素材。

## 本机运行

需要 Node.js 24.14 或更新的 24.x 版本，以及 npm。在 PowerShell 中：

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run hash-password
```

把邮箱和命令输出的密码哈希填入 `.env.local` 的 `PLYPOST_OWNER_EMAIL`、`PLYPOST_OWNER_PASSWORD_HASH`，然后运行 `npm run dev`，打开 [http://localhost:3000](http://localhost:3000)。

登录不会因连续输错而锁定；公开演示账号务必使用强随机密码。登录请求仍限制为 4 KiB。
更换 `PLYPOST_OWNER_PASSWORD_HASH` 后，先前的登录会话会失效，需要用新密码重新登录。Render 演示站在 **Environment** 中替换该变量并部署；新哈希可在本机运行 `npm run hash-password` 生成，命令不会显示输入的明文密码。

需要处理到期的模拟任务或已确认的 Mastodon 定时任务时，另开一个终端运行 `npm run worker`。数据默认存于 `data/plypost.sqlite`；请保管好数据库和导出的备份。`.env.local` 与 `data/` 不会提交到 Git。

## 可选配置

| 功能 | 配置 |
| --- | --- |
| AI 写作 | 统一使用 Nebius Token Factory 和 `NEBIUS_API_KEY`。文字任务用 `nvidia/nemotron-3-super-120b-a12b`；图片起稿用 `nvidia/Nemotron-3.5-Super-VL`。手动点击分析旧帖会发送选中的文字，点击看图起稿会发送指定的一张图片、可选背景说明及已勾选的风格指南；点击主编辑器的文案改写会发送当前草稿和已勾选指南；点击人工发布文案旁的改写只发送该框的文字与目标平台；点击生成周计划只发送品牌资料，不发送发帖结果。密钥只留在服务端。 |
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

公开演示站的首页和 `/api/health` 已从外部网络返回 200；新密码登录及会话接口已在该实例返回 200。虚构文案的单平台改写、双平台改写和合成图片的看图起稿也已在该实例返回可用结果；重启后的持久保存仍需验收。Nebius × NVIDIA 大赛的技术路径、验证记录和未完成的提交材料见[参赛准备](docs/hackathon.md)。截至 2026-10-25，`npm audit --omit=dev --audit-level=high` 报出 15 条高危依赖路径，均关联 Bluesky OAuth 依赖所用的 Zod 3 与[这项安全公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)；该依赖仍要求 Zod 3，不能靠强制覆盖为 Zod 4 来安全消除告警。公开启用 Bluesky 登录前须重新评估或等待兼容修复。下一步见[开发计划](DEVELOPMENT_PLAN.md)，各平台的接入门槛见[平台笔记](docs/platforms.md)。

演示站的持久存储和上线验收步骤见[托管方案](docs/hosting.md)。

仓库另备有可选的 [Render Blueprint](render.yaml)，用于重建单实例、持久磁盘的评委演示。当前线上服务是手动创建的，尚未通过该 Blueprint 重建。
