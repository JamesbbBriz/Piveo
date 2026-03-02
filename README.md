<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Piveo 本地运行

本项目是一个单图生成套图 + 首帧视频的 AI 工作台（含 BrandKit 约束），默认对接 `https://n.lconai.com`（OpenAI 风格网关）。

## 启动

**前置条件：** Node.js

1. 安装依赖：
   `npm install`
2. 配置 `.env.local`（可参考 `.env.example`）：
   - `UPSTREAM_AUTHORIZATION`：服务端访问上游网关的鉴权头（例如：`Bearer sk-xxx`）
   - `UPSTREAM_API_BASE_URL`：上游网关地址（默认 `https://n.lconai.com`）
   - 推荐开发环境：`VITE_API_BASE_URL=/api`（前端只打本地代理）
   - `VITE_DEFAULT_IMAGE_MODEL`：默认生图模型（默认：`gemini-2.5-flash-image`）
   - `VITE_IMAGE_FETCH_TIMEOUT_MS`：前端等待图片接口超时时间（毫秒，默认 `120000`）
   - `VITE_ENABLE_CHAT_IMAGE_FALLBACK`：是否启用 `chat/completions` 出图回退（默认关闭，建议不上线开启）
   - `VITE_IMAGE_REQUEST_RETRIES`：图片请求自动重试次数（默认 `2`）
   - `VITE_IMAGE_RETRY_BASE_DELAY_MS`：重试基础延迟毫秒（默认 `1200`）
3. 启动开发服务器（会同时启动前端和登录服务）：
   `npm run dev`

如果你只想单独启动某一项：
- 前端：`npm run dev:web`
- 认证服务：`npm run dev:auth`
- 端口默认：前端 `3000`，认证服务 `3101`（避免与 Vite 自动端口冲突）

## 运行时配置

接口地址和鉴权令牌统一放在服务端 `.env.local` 配置（不在前端填写）：
- `VITE_API_BASE_URL`
- `UPSTREAM_API_BASE_URL`
- `UPSTREAM_AUTHORIZATION`

模型在左侧栏底部切换器选择；切换器下方显示余额（若网关未开放 billing 端点则显示“暂不可用”）。

## 登录功能

- 已增加登录鉴权（`/auth/login`、`/auth/session`、`/auth/logout`）。
- 默认预置用户：
  - 账号：`guoboss`
  - 密码：`qazwsxedc1229`
- 可通过 `.env.local` 覆盖：
  - `AUTH_USER`
  - `AUTH_PASSWORD`
  - `AUTH_JWT_SECRET`
- 上线建议：
  - `AUTH_JWT_SECRET` 使用高强度随机字符串。
  - `UPSTREAM_AUTHORIZATION` 仅放服务端环境变量，禁止使用 `VITE_` 前缀。
  - `/api` 已强制登录后访问，登录接口已带基础限流。
  - 使用 `npm run build` 后通过 `npm run start` 启动（同进程提供鉴权 + /api 代理 + 静态资源）。

## 数据持久化

- 已启用 `IndexedDB` 持久化（会话、模板、模特）。
- 兼容 `localStorage` 回退。
- 首次启动会自动把旧 `localStorage` 数据迁移到 `IndexedDB`。

## 常见报错与处理

- `not supported model for image generation`
  - 原因：当前账号分组不支持你填的模型，或填到了视频模型。
  - 处理：在左侧栏底部模型切换器里切到可用模型（推荐 `gemini-2.5-flash-image` / `gpt-image-1.5`）。

- `Failed to generate model`
  - 原因：本质仍是图片生成接口失败（通常是模型或鉴权问题）。
  - 处理：检查 `.env.local` 中的 `UPSTREAM_AUTHORIZATION`、`UPSTREAM_API_BASE_URL`、默认模型配置。

- `HTTP 504 / Gateway time-out`
  - 原因：上游网关超时（Cloudflare 504），不是前端代码异常。
  - 处理：重试一次；或切到更快模型（如 `gemini-2.5-flash-image`）；并确认没有走 `chat/completions` 回退链路。

## 开源协议

本项目采用 `GNU AGPL v3`（`AGPL-3.0-or-later`）开源。

- 协议全文见 [`LICENSE`](./LICENSE)
- 贡献规范见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- 社区治理见 [`GOVERNANCE.md`](./GOVERNANCE.md)
- 行为准则见 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- 安全策略见 [`SECURITY.md`](./SECURITY.md)

## 项目改名说明

项目对外品牌统一为 `Piveo`。如果你的远端仓库仍是旧名（例如 `TopSeller`），可在 GitHub 完成仓库 rename 后执行：

```bash
git remote set-url origin https://github.com/<your-org-or-user>/Piveo.git
git remote -v
```

> 说明：为避免影响历史数据，部分内部持久化 key 仍保留旧前缀，不影响对外品牌名称。
