# 平台接入笔记

核对于 2026-10-24。这里只记录下一步开发需要的门槛；平台政策和接口会变，动手接入前要重新核对官方文档和开发者后台。**文档允许发帖，不代表 Plypost 已拿到权限。**

| 平台 | 当前实现 | 继续接入前要确认 |
| --- | --- | --- |
| [Bluesky](https://atproto.com/specs/oauth) | 本地账号连接、逐条确认的纯文字发帖；未用真实账号验收。 | 本地 OAuth 回调、发帖回执与撤销；公网使用还需 HTTPS 客户端元数据。图片另需上传及权限。 |
| [Mastodon](https://docs.joinmastodon.org/methods/statuses/) | 本地账号连接、逐条确认的纯文字发帖和定时队列；未用真实账号验收。 | 目标实例的账号、OAuth 回调、权限、字数限制和故障恢复。定时任务由本机 worker 执行。 |
| [LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) | 人工发布清单。 | 开发者应用实际获得的 `w_member_social` 权限，以及 [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) 对该应用是否可用；Web 回调要 HTTPS。 |
| [Threads](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) | 人工发布清单。 | Meta 应用、`threads_content_publish`、用户授权及外部用户审核；媒体还需平台可读取的公网 URL。 |
| [Facebook Pages](https://developers.facebook.com/docs/graph-api/reference/page/feed/) | 人工发布清单。 | 仅讨论有管理权限的 Page；需核实当前版本的发布权限和审核，不能推断个人资料页也能直发。 |
| [Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | 人工发布清单。 | 官方发布接口面向专业账号，需选定登录方式、媒体格式、审核与可访问的素材地址。纯文字帖不适用。 |
| [TikTok](https://developers.tiktok.com/docs/en/content-posting-api-get-started) | 人工发布清单。 | `video.publish` 审批、用户授权、内容审计和发布前选项；只做视频或照片，不做纯文字直发。 |
| X、YouTube、Pinterest、Reddit | 人工发布清单。 | 尚未评估官方直发权限；目前由用户自己在平台发布。 |

当前的普通计划日历只做模拟处理；人工发布清单也不会替用户登录或发帖。`src/lib/publishers/` 下四个平台的普通适配器仍是模拟实现，不能把它们当作真实发布接口。

Bluesky 本地登录须始终使用配置的同一个 `127.0.0.1` 地址和端口。`localhost` 与 `127.0.0.1` 的 Cookie 不共用；混用会让回调找不到原会话。正式公网接入和多进程运行仍需单独设计与验证。

真实接入的验收至少包括：账号授权与断开、发布前确认、平台回执、过期授权、限流和网络结果不明时的处理。定时发帖还要检查重启后的恢复与重复发布风险。以上都需要经账号持有人同意的测试账号；本地模拟测试不能替代。
