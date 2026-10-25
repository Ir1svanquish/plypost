# Nebius × NVIDIA 大赛准备

拟参加 [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/rules) 的 **Best Apps and Agents** 赛道。截止时间为 2026 年 10 月 30 日 10:00 PDT。官方规则要求应用运行时调用 Nebius Token Factory 或部署在 Nebius AI Cloud，并使用至少一个 NVIDIA 开源模型。

Plypost 的默认 AI 路径是服务端请求 Nebius Token Factory 的 `/v1/chat/completions`，模型为 NVIDIA Nemotron 3 Super（`nvidia/nemotron-3-super-120b-a12b`）。用户明确点击后，应用才发送当前草稿用于逐平台改写，或发送已保存的品牌资料用于一周选题；生成内容必须由用户检查、修改和确认。AI 不负责自动向社交平台发帖。

本机验证记录（2026-10-25）：Token Factory 模型列表包含该模型；用固定样例文案与虚构品牌资料分别调用 Nemotron 3 Super，返回四个平台的可解析文案与一周选题。另从本机生产构建的 HTTP 接口完成登录、文案生成、品牌资料保存及周计划生成，结果写入隔离的测试数据库。`npm run typecheck`、`npm run lint`、149 项测试和 `npm run build` 通过；独立演示进程的开发模式与生产构建模式都完成登录及草稿、人工待办、排程的 HTTP 读取。计划页的新日期操作在生产构建的隔离演示账号下完成了清除、重新设定及手机宽度检查。生产构建的 `/api/health` 返回 200，且数据库无法打开时返回 503。密钥只在本机被 Git 忽略的 `.env.local` 中使用；仓库不包含密钥。以上仍不能代替公开演示或正式提交。

现有[本机演示流程](demo.md)使用独立的虚构品牌、草稿、排程和人工发布待办。它只是可复现的本机样例；标记为“已发布”的样例没有向平台发帖，预填内容也不是模型生成。现场 AI 演示须配置 Nebius 密钥并由演示者点击生成。

公开前检查（2026-10-25）：当前 GitHub 仓库仍为私有；已跟踪文件中只有空值模板 `.env.example`，没有 `data/` 或本机 `.env.local`。对已跟踪文本查找长格式 Nebius/GitHub 令牌及私钥头未命中。直接运行依赖的包声明为 MIT、ISC 或 Apache-2.0，但这不等于完成所有素材和传递依赖的授权审查。两份 Logo 是本项目的 SVG，测试视频为 16×16、1 秒的 H.264 样片；公开前仍需由项目所有者确认素材来源。生产依赖审计仍报 15 条高危路径，均关联 Bluesky OAuth 使用的 Zod 3；当前上游 `@atproto/oauth-client-node` 仍为 0.5.12。公开开启 Bluesky 登录前必须处理或隔离这一风险。

隔离的生产演示没有设置 Bluesky 连接参数。实际 HTTP 检查显示账号状态为 `configured: false`，连接请求返回 400，回调请求返回 503；代码也要求有效的本机回环地址与独立密钥才会建立 OAuth 客户端。上游响应在进入 SDK 前受 256 KiB 限制。这些门槛降低了未配置演示的暴露面，但不消除依赖告警，也不能代替在真实账号下的安全验收。

根据[官方提交规则](https://nebiusglobalaihackathon.devpost.com/rules)，还需要：

1. 可让评委访问的运行中演示、托管应用或测试构建，以及测试说明。当前没有公开部署；[低成本托管方案](hosting.md)已准备，尚未创建服务。
2. 公开的源码仓库和显眼的开源许可证。已按项目所有者选择在仓库顶层加入 MIT 许可证；当前 GitHub 仓库仍是私有的，公开前还须确认素材来源并复查敏感文件。
3. 公开上传到 YouTube、少于三分钟且展示实际运行的演示视频。尚未录制或上传。
4. 英文功能描述、所选赛道、Nebius/NVIDIA 使用说明与反馈，以及 Devpost 提交。尚未提交。

公开仓库、上线演示和上传视频都应在技术与素材检查完成后由项目所有者确认。不要把本机通过构建或一次 API 调用写成已满足全部参赛条件。
