<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TopSeller（图销冠）本地运行

本项目是一个图片生成/编辑工作台，默认对接 `https://n.lconai.com`（OpenAI 风格网关）。

## 启动

**前置条件：** Node.js

1. 安装依赖：
   `npm install`
2. 配置 `.env.local`（可参考 `.env.example`）：
   - `VITE_AUTHORIZATION`：完整的鉴权头（Authorization，例如：`Bearer sk-xxx`）
   - 推荐开发环境：`VITE_API_BASE_URL=/api` + `VITE_API_PROXY_TARGET=https://n.lconai.com`（用 Vite 代理绕过浏览器 CORS）
   - `VITE_DEFAULT_IMAGE_MODEL`：默认生图模型（默认：`gemini-2.5-flash-image`）
3. 启动开发服务器：
   `npm run dev`

## 运行时配置

接口地址和鉴权令牌统一放在 `.env.local` 配置（不在前端填写）：
- `VITE_API_BASE_URL`
- `VITE_AUTHORIZATION`（或 `VITE_API_KEY`）

模型在左侧栏底部切换器选择；切换器下方显示余额（若网关未开放 billing 端点则显示“暂不可用”）。

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
  - 处理：检查 `.env.local` 中的地址/令牌/默认模型；建议开发环境先用 `/api` 代理。
