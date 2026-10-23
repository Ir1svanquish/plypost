# 官方平台发布接入调查

核对日期：2026-10-23。本文为 Plypost 后续开发的接入依据；平台规则可能改变，正式上线前须重查对应版本的官方文档及开发者后台。**文档支持某种发布能力，不等于 Plypost 已获得权限或完成真实账号验收。**

## 当前产品边界

Plypost 的四个平台“模拟发布”和排程 worker 不会向社交平台发帖；辅助发布由用户自己在目标平台完成。只有 Mastodon 另有独立的即时真实**文字**发布代码路径，目前经过本地模拟实例测试，尚未完成真实测试账号的授权、发帖、撤销和回执核对。Mastodon 的真实定时排程模块已准备，但创建与后台发送均关闭，等待明确授权。Bluesky、LinkedIn、Threads 的 `src/lib/publishers/` 适配器仍为模拟实现。其他平台目前只在辅助发布中出现。

## 平台能力与门槛

下表的“已核实”来自链接的官方文档或平台维护的官方 Postman 集合；“待核实”不得作为已取得上线权限的依据。

| 平台 | 已核实的账号、内容与权限 | 回调和审核边界 | Plypost 下一步 |
| --- | --- | --- | --- |
| [Bluesky / AT Protocol](https://atproto.com/specs/oauth) | 用户授权的账号可写 `app.bsky.feed.post` 记录，文字必需 `text` 和 `createdAt`；图片先上传 blob 后嵌入帖子。OAuth 必需 `atproto`，可按最小权限请求 `repo:app.bsky.feed.post?action=create`；上传图片还需单独的 `blob:*/*`。[发帖](https://atproto.com/guides/writing-data) · [图片](https://atproto.com/guides/images-and-video) · [权限](https://atproto.com/specs/permission) | 正式 Web 客户端要提供可公开读取的 HTTPS `client_id` 元数据与 HTTPS 回调；本地开发有 `http://localhost` 特例，但授权服务器可选择不支持，且 `client_id` 不能写端口。OAuth 还要求 PKCE、PAR、DPoP、`state` 和发行方校验。[OAuth 规范](https://atproto.com/specs/oauth) | 做账号 OAuth、纯文字发布、回执 `uri`/`cid`、撤销与结果不明处理；图片另验。优先使用窄权限，按测试服务器实际支持情况验证 localhost 特例。 |
| [Mastodon](https://docs.joinmastodon.org/methods/oauth/) | 各实例自行提供账号和应用注册。`write:statuses` 可调用 `POST /api/v1/statuses` 发文字；增加 `write:media` 与媒体上传后可附 `media_ids`。服务端提供 `scheduled_at`，但必须至少在五分钟之后；`Idempotency-Key` 最多保存约一小时。[状态](https://docs.joinmastodon.org/methods/statuses/) · [媒体](https://docs.joinmastodon.org/methods/media/) | OAuth 回调须与应用注册值匹配；4.3+ 支持 PKCE。文档未给所有实例统一的 localhost 许可，必须在目标实例验证。文字、媒体上限由实例配置决定。[应用注册](https://docs.joinmastodon.org/methods/apps/) · [实例配置](https://docs.joinmastodon.org/entities/Instance/) | 先用用户同意的测试账号走完现有连接、发帖、撤销、回执和故障恢复；再考虑媒体与服务器原生排程。 |
| [LinkedIn 个人账号](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) | 自助产品 **Share on LinkedIn** 授予 `w_member_social`；其指南给出 `/v2/ugcPosts` 发布文字、URL 和图片。新版 [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06) 给出 `/rest/posts`，说明它取代 `ugcPosts`，支持更多格式。公司 Page 发布另需 `w_organization_social` 和相应 Page 角色。 | 当前 Web OAuth 指南要求预先登记 HTTPS 绝对回调。[OAuth](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)；新版 Community Management 有需申请的 Development/Standard 分级与演示要求。[计划准入](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-09) **待核实：**自助 `w_member_social` 在实际新应用上能否调用新版 `/rest/posts`，以及旧 `/v2/ugcPosts` 的当前可用性。 | 先建立真实开发者应用，在开发者后台查看已授予的产品/范围，用受控测试账号和 HTTPS 回调验证一种**个人文字帖**；按实际获准接口实现，不能仅凭两个并存的文档选接口。 |
| [Threads](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) | 须有 Meta App 的 Threads use case，用户 OAuth 和包含 `threads_basic`、`threads_content_publish` 的授权。可创建文字容器，并以 `auto_publish_text=true` 直接发布，或再调用 `/me/threads_publish`；图片/视频容器需要 Meta 可访问的公网媒体 URL。[授权与接口示例](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=folder-34203612-995a4593-61de-4558-9b26-6c8becae85e4) | 回调必须与授权时的 URI 完全一致；官方集合提供短期 token 交换、长期 token 交换与刷新流程。**待核实：**Meta 开发者后台对非应用角色用户的审核条件与本机 HTTP 回调许可；本次开发者文档页面抓取返回 429，不能据此断言已获外部用户接入资格。 | 在开发者后台确认审核和回调要求后，先接纯文字、token 生命周期、平台 ID/URL 回执；有可信公网素材地址后再做媒体。 |
| [Facebook Pages](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api) | Meta 官方集合展示先以用户 token 查询 `/me/accounts`，取得有管理任务的 Page 及 Page token，后者代表 Page 操作；集合也展示 Page Reels 的上传与发布。Meta 的 [Page feed 文档入口](https://developers.facebook.com/docs/graph-api/reference/page/feed/) 对应普通 Page 帖子的接口。 | **待核实：**本次 Meta Page feed 文档入口返回 429，因此普通文字/图片端点的当前参数、`pages_manage_posts` 等准确权限组合、App Review/Advanced Access 与非角色用户限制，均须在官方开发者后台及当前 Graph API 版本再确认。不能把 Page 能力推断为个人 Facebook 资料页直发。 | 先锁定“用户有内容创建权的 Page”的业务场景、官方权限与审核材料，再用测试 Page 验证文字发布及 Page token；暂维持辅助发布。 |
| [Instagram Professional](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | 只面向 Business/Creator 专业账号，不能通过该 API 给普通个人账号发帖。Facebook Login 路线要求关联 Facebook Page，发布范围为 `instagram_content_publish`；[Instagram Login 路线](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) 不要求关联 Page，发布范围为 `instagram_business_content_publish`。媒体走创建容器、等待处理、`media_publish`；示例中的 Reels 视频 URL 必须能从公网抓取。纯文字帖不是当前发布格式。 | **待核实：**选择哪条登录路线、外部用户的审核/高级权限、回调限制及目标内容类型的具体约束；需以 Meta 开发者后台和目标 API 版本复核。 | 先明确支持专业账号和一种媒体格式（如单图），准备经授权的公网素材存储，再验证容器处理与回执；个人账号继续辅助发布。 |
| [TikTok](https://developers.tiktok.com/docs/en/content-posting-api-get-started) | Direct Post 要开发者应用、Content Posting API、经审批的 `video.publish` 范围和用户授权。支持视频与照片，不支持纯文字直发。视频可文件上传或由已验证域名拉取，照片需已验证域名 URL。[媒体传输](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) | 未通过审计的客户端仅可 `SELF_ONLY` 私密发布，最多五位用户/24 小时；公开发布须审计。发布页必须读取 creator info，让用户选择隐私与互动设置、明确同意。Web Login Kit 的回调须为已登记的静态 HTTPS URL，裸 `http://localhost` 不符合 Web 规则。[内容分享规范](https://developers.tiktok.com/docs/en/content-sharing-guidelines) · [Web OAuth](https://developers.tiktok.com/docs/en/login-kit-web) | 在账号、审计、HTTPS 回调及公网素材准备好之前保留辅助发布；首个直发版本需完整实现 TikTok 特有的发布前选项和审核流程。 |

## 接入顺序与验收条件

**优先级判断（推断）：**先完成 Mastodon 真实账号验收，再验证 LinkedIn 个人纯文字的实际准入；如果 LinkedIn 自助与新版接口的落差阻塞，则先转向 Bluesky OAuth 或 Threads 纯文字。Facebook Pages、Instagram、TikTok 分别增加 Page 管理权、专业账号/公网媒体、内容审计和专门发布页的成本。这一顺序基于现有文字编辑工作流与上述文档门槛，尚未经过目标用户访谈。

每个平台接入应满足同一组可检查的完成标准：用户明确授权且可断开；只展示该账号与内容格式确实能用的“真实发布”操作；发布前锁定文案/媒体快照；记录平台 ID 和可核对链接；处理过期授权、限流、拒绝、处理中和网络结果不明；避免结果不明时盲目重试；用用户同意的测试账号验证授权、发帖、回执和撤销。自动排程另需验证到期执行、重启恢复和外部已成功但本地尚未写回执的重复风险。模拟测试、合同测试或开发者文档本身均不能替代真实账号验收。

## 本机运行与托管服务

当前 SQLite 与独立 worker 都在用户电脑上。浏览器关闭不妨碍正在运行的 worker，但电脑休眠、断电或进程停止会推迟任务；恢复后只能补做待处理项。若承诺长期准时发布，需要持续运行的托管进程、持久数据库、受监控的队列、备份和凭证更新。LinkedIn/TikTok Web OAuth 和 AT Protocol 正式 Web 客户端需要 HTTPS 回调/元数据；Threads、Instagram 以及 TikTok 的远程媒体抓取还需要合规的公网素材 URL。公网入口同时带来账号数据与 token 的安全维护工作，不能把本地预览称为云端部署。

开发阶段可先实现接口契约、独立平台适配器和无密钥的模拟测试，但真实连接按钮必须以实际应用注册、权限和外部回调配置为前提。所有客户端密钥、用户 token、刷新 token 与加密密钥只存服务端受保护配置/数据库；仓库只保存变量名与示例值。
