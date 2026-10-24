# Plypost

Plypost 是一个本机运行的多平台发帖工作台。写一份草稿，再按平台改文案、存图片、设提醒。它目前没有云端服务。

## 现在能做什么

- 为 Bluesky、Mastodon、LinkedIn、Threads 保存不同版本的文案和预览，草稿最多附四张图片。可以先存标题、图片或单个平台的文案，发布前再补齐内容。
- 为上述平台以及 X、Facebook Pages、Instagram、TikTok、YouTube、Pinterest、Reddit 建立人工发布清单。平台按图文优先、视频优先分组；可以逐平台改文案，保存图片或短视频，并下载包含文案和素材的发布包。同一段视频可附到一批不同平台的待办，未发布前还能逐条更换或移除。发帖仍由你在目标平台完成。
- 保存草稿、安排提醒、导出备份。日历里的模拟发布不会向平台发帖。
- 配置 Nebius 或 NVIDIA 后，手动生成文案改写或一周选题。不配置也能使用草稿和人工发布功能。

另有 Bluesky 和 Mastodon 的纯文字发帖入口，以及 Mastodon 的本机定时队列。这些入口**尚未经过真实账号验收**。定时队列依赖本机 worker；电脑休眠或进程关闭时不会准时执行。图片目前只用于人工发布。

短视频只用于人工发布：支持 MP4、WebM、MOV，单个不超过 32 MiB，本机视频库最多 12 个、共 64 MiB。选中视频后可在浏览器里播放检查；浏览器不能解码时仍可下载原文件。应用按原样保存视频，不转码或清除元数据，也不保证目标平台接受该文件。**Download full backup** 包含图片和视频，上限 192 MiB；普通文本 JSON 不含素材文件。备份里有私有内容，请妥善保管。

人工发布里的“Due now”只表示提醒时间已到。YouTube 没有附视频，或 Instagram、TikTok、Pinterest 没有附图片或视频时，清单会提示你在发布前补上素材。

## 本机运行

需要 Node.js 24.14+ 和 npm。在 PowerShell 中：

```powershell
npm install
Copy-Item .env.example .env.local
npm run hash-password
```

把邮箱和命令输出的密码哈希填入 `.env.local` 的 `PLYPOST_OWNER_EMAIL`、`PLYPOST_OWNER_PASSWORD_HASH`，然后运行 `npm run dev`，打开 [http://localhost:3000](http://localhost:3000)。

需要处理到期的模拟任务或已确认的 Mastodon 定时任务时，另开一个终端运行 `npm run worker`。数据默认存于 `data/plypost.sqlite`；请保管好数据库和导出的备份。`.env.local` 与 `data/` 不会提交到 Git。

## 可选配置

| 功能 | 配置 |
| --- | --- |
| AI 文案与选题 | 在 `.env.local` 中填写 `NVIDIA_API_KEY` 或 `NEBIUS_API_KEY`。只有点击生成时才会请求服务；周计划只发送品牌资料，不发送发帖结果。 |
| Bluesky 账号 | 填写 `PLYPOST_BLUESKY_ORIGIN` 和 `PLYPOST_BLUESKY_SECRET`，然后在 **Account** 中连接。浏览器地址须与配置一致。 |
| Mastodon 账号 | 有账号时再填写 `PLYPOST_MASTODON_INSTANCE`、`PLYPOST_PUBLIC_ORIGIN` 和 `PLYPOST_MASTODON_SECRET`。可用 `PLYPOST_MASTODON_SCHEDULE_ENABLED=false` 暂停新的定时任务和后续派发，改动后须重启应用与 worker。 |

两个 `*_SECRET` 应分别使用独立的 32 字节随机密钥。具体格式见 [.env.example](.env.example)。恢复备份不会取消本机已经排入真实发布队列的 Mastodon 帖子。

## 检查

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

当前只有本机构建，没有线上部署。Bluesky OAuth 依赖链仍有高危审计项；公开提供登录前，请运行 `npm audit --omit=dev --audit-level=high` 并处理结果。下一步见[开发计划](DEVELOPMENT_PLAN.md)，各平台的接入门槛见[平台笔记](docs/platforms.md)。
