# Plypost

Plypost 是一个本机运行的多平台发帖工作台。写一份草稿，再按平台改文案、存图片、设提醒。它目前没有云端服务。

## 现在能做什么

- 为 Bluesky、Mastodon、LinkedIn、Threads 保存不同版本的文案和预览。草稿最多附四张图片和一段视频；也可以先存标题或素材，发布前再补文案。
- 为上述平台以及 X、Facebook Pages、Instagram、TikTok、YouTube、Pinterest、Reddit 建立人工发布清单。平台按图文优先、视频优先分组；可以逐平台改文案，保存图片或短视频，并下载包含文案和素材的发布包。同一段视频可附到一批不同平台的待办；每条未发布待办都能单独调整图片、说明和视频，不影响原草稿或其他待办。发帖仍由你在目标平台完成。
- 写帖页把图文预览与视频平台入口分开；点击 YouTube 或 TikTok 会打开对应的人工发布表单。点击“Prepare a manual post”会带着当前文案和视频打开人工发布表单，即使已有其他待办也能直接新建。
- 草稿库可搜索标题和文案，按已选平台或附带视频筛选，并按最近修改或目标日期查看；没有目标日期的草稿排在目标日列表末尾。
- 新建人工发布待办时，图文和视频分组只用于浏览平台；点选具体平台才会切换目标。每个平台正在编辑的临时文案会保留，也能单独恢复为当前草稿文案；加入清单后才会保存。
- 草稿可设一个目标日期，方便在计划日历里看到还没完成的内容。目标日期只用于规划，不会创建提醒或自动发布；日期可修改或清除。人工待办另设提醒。日历里的模拟发布也不会向平台发帖。
- 在日历中的草稿可以直接进入逐平台人工发布准备。日历会显示同一草稿已有多少条人工待办，以及目标日是否已经过去；点击“Prepare handoffs”仍需逐平台检查并确认，不会直接发帖。
- 批量准备时若不填写提醒时间，待办只留在 Assisted 清单，不会被计入到期提醒或出现在日期日历。旧版已保存的待办仍按其原记录显示，可逐条移除不需要的提醒。
- 发布后可手动记录浏览量、点赞、回复和备注。计划页汇总最近录入的单篇结果，可打开原记录，或从已发布文案开始一篇未保存的新草稿。指标和备注由你录入，Plypost 不验证、不用于 AI 周计划，也不跨平台排名；若后来对草稿手动点击 AI 文案改写，草稿文字会按该功能的提示发送。
- 配置 Nebius Token Factory 后，可用其托管的 NVIDIA Nemotron 3 Super 手动生成逐平台文案和一周选题；NVIDIA API 仍可作为另一种配置。不配置也能使用草稿和人工发布功能。逐平台文案会先与当前版本对照，只有勾选并应用的版本才替换编辑器内容；一周选题也须经人审阅后才能变成草稿。

另有 Bluesky 和 Mastodon 的纯文字发帖入口，以及 Mastodon 的本机定时队列。这些入口**尚未经过真实账号验收**。定时队列依赖本机 worker；电脑休眠或进程关闭时不会准时执行。图片目前只用于人工发布。

短视频可随草稿保存，并带入人工发布待办；不会随模拟或纯文字直发上传。支持 MP4、WebM、MOV，单个不超过 32 MiB，本机视频库最多 12 个、共 64 MiB。选中视频后可在浏览器里播放检查；浏览器不能解码时仍可下载原文件。应用按原样保存视频，不转码或清除元数据，也不保证目标平台接受该文件。**Download full backup** 包含草稿引用的图片和视频，上限 192 MiB；普通文本 JSON 不含素材文件。备份里有私有内容，请妥善保管。

人工发布时，时间留空会加入无提醒清单，不触发到期通知，也不占据日历日期；之后可为这条待办添加、修改或移除提醒。“Due now”只表示已设置的提醒时间到了。YouTube 没有附视频，或 Instagram、TikTok、Pinterest 没有附图片或视频时，清单会提示你在发布前补上素材。

## 本机运行

需要 Node.js 24.14+ 和 npm。在 PowerShell 中：

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run hash-password
```

把邮箱和命令输出的密码哈希填入 `.env.local` 的 `PLYPOST_OWNER_EMAIL`、`PLYPOST_OWNER_PASSWORD_HASH`，然后运行 `npm run dev`，打开 [http://localhost:3000](http://localhost:3000)。

需要处理到期的模拟任务或已确认的 Mastodon 定时任务时，另开一个终端运行 `npm run worker`。数据默认存于 `data/plypost.sqlite`；请保管好数据库和导出的备份。`.env.local` 与 `data/` 不会提交到 Git。

## 可选配置

| 功能 | 配置 |
| --- | --- |
| AI 文案与选题 | 默认使用 Nebius Token Factory 上的 `nvidia/nemotron-3-super-120b-a12b`；在 `.env.local` 中填写 `NEBIUS_API_KEY` 即可。可用 `NEBIUS_MODEL` 覆盖模型；若要走 NVIDIA 的独立接口，则另填 `NVIDIA_API_KEY` 并在界面选择。点击文案改写会发送当前草稿文字；点击生成周计划只发送已保存的品牌资料，不发送发帖结果。 |
| Bluesky 账号 | 填写 `PLYPOST_BLUESKY_ORIGIN` 和 `PLYPOST_BLUESKY_SECRET`，然后在 **Account** 中连接。浏览器地址须与配置一致。 |
| Mastodon 账号 | 有账号时再填写 `PLYPOST_MASTODON_INSTANCE`、`PLYPOST_PUBLIC_ORIGIN` 和 `PLYPOST_MASTODON_SECRET`。可用 `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` 暂停新的定时任务和后续派发，改动后须重启应用与 worker。 |

两个 `*_SECRET` 应分别使用独立的 32 字节随机密钥。具体格式见 [.env.example](.env.example)。恢复备份不会取消本机已经排入真实发布队列的 Mastodon 帖子。

配置好 Nebius 密钥后，可选运行 `npm run smoke:nebius`：它用固定样例文案和虚构品牌资料做两次模型调用，检查四个平台版本和周计划，不会读取本机草稿或品牌资料。密钥和输出不会写入仓库。

## 检查

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

当前只有本机构建，没有线上部署。Nebius × NVIDIA 大赛的技术路径、验证记录和未完成的提交材料见[参赛准备](docs/hackathon.md)。Bluesky OAuth 依赖链仍有高危审计项；公开提供登录前，请运行 `npm audit --omit=dev --audit-level=high` 并处理结果。下一步见[开发计划](DEVELOPMENT_PLAN.md)，各平台的接入门槛见[平台笔记](docs/platforms.md)。
