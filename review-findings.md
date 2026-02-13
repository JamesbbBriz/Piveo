# TopSeller Studio 第二轮审查报告

> 代码质量 + 性能双线审查，基于磁盘最新版本（含未提交修改）
> 审查日期：2026-02-13
> 上一轮 review-findings.md 中已修复的 P0/P1 共 19 项不再重复

---

## P0 — 必须立即修复

### P0-1. 服务端硬编码默认凭据泄露（安全）
- **来源**：代码质量
- **文件**：`server/index.mjs:24-25`
- **问题**：硬编码默认用户名 `guoboss` 和密码 `qazwsxedc1229`。任何有代码访问权限的人都能看到。`AUTH_USER` 检查仅在 `AUTH_PASSWORD` 未设置时才报错。
- **修复建议**：移除硬编码凭据，未配置时启动报错。已暴露的密码应立即轮换。

### P0-2. `filterSizesByAspect` 逻辑错误导致自定义尺寸被丢弃
- **来源**：代码质量
- **文件**：`services/sizeUtils.ts:45-49`
- **问题**：该函数只返回标准尺寸或空数组，用户在设置面板选的多尺寸批量生成实际完全不生效。
- **修复建议**：允许返回用户选择的所有兼容尺寸，或在 UI 层限制用户选择。

### P0-3. `imagesEdits` 重试时复用已消耗的 FormData
- **来源**：代码质量
- **文件**：`services/openaiImages.ts:795-842`
- **问题**：retry 循环中复用同一个 `fd`，部分浏览器 fetch 读取后流会消耗，重试请求发空 body → 400。
- **修复建议**：每次 retry 重新构建 FormData。

### P0-4. 遮罩编辑 fallback 路径 `isGenerating` 闪烁 + 重复提交窗口
- **来源**：代码质量
- **文件**：`App.tsx:805-816`
- **问题**：`imagesEdits` 失败时 `finally` 重置 `isGenerating=false`，随后 `executeGeneration` 再设为 true — 中间窗口期用户可再次点击发送。
- **修复建议**：fallback 路径中不在 finally 重置 isGenerating，让后续 executeGeneration 管理。

### P0-5. `saveSessions` 将含 base64 图片的完整 sessions JSON.stringify 写 localStorage
- **来源**：性能
- **文件**：`services/storage.ts:137-148`
- **问题**：10 张图片场景 JSON.stringify 约 10-30MB 字符串，耗时 50-200ms 阻塞主线程。且 localStorage 5MB 限制必定写入失败，但 CPU 开销已发生。
- **修复建议**：deferLocalSet 添加大小检查（>2MB 跳过），或只写元数据不写图片数据。

### P0-6. `ChatMessage` 的回调未 useCallback，React.memo 完全失效
- **来源**：性能
- **文件**：`App.tsx:968-977`
- **问题**：传给 ChatMessage 的 `handleVariation`、`openMaskEdit`、`(url) => setSelectedImage(url)` 等回调每次渲染新引用，memo 无效。30 条消息时每次按键额外 10-30ms。
- **修复建议**：useCallback 包裹回调；`onUseAsReference` 直接传 `setSelectedImage`。

### P0-7. 模板下拉菜单无点击外部关闭
- **来源**：代码质量
- **文件**：`components/SystemPromptBar.tsx:72-87`
- **问题**：模板下拉菜单只能通过再次点击按钮或选择模板关闭，点击其他区域不关闭，遮挡内容。
- **修复建议**：添加 document mousedown 监听器，点击菜单外部时关闭。

### P0-8. `downloadImageWithFormat` 创建全尺寸 canvas 未释放，连续下载内存膨胀
- **来源**：性能
- **文件**：`services/imageDownload.ts:73-97`
- **问题**：1792x1024 图片 canvas 内部位图 ~7MB + 源 blob + Image + 输出 blob，峰值 ~28MB/次。连续下载 5 张大图峰值 +140MB。
- **修复建议**：finally 中 `canvas.width = 0; canvas.height = 0` 释放位图；源格式与目标格式相同时跳过转换。

---

## P1 — 短期改进

### P1-1. `SettingsPanel.tsx` 已成死代码（560+ 行）
- **来源**：代码质量
- **文件**：`components/SettingsPanel.tsx`
- **问题**：未被任何文件导入或使用，功能已被 PromptModelPanel + SystemPromptBar + CreativeSettingsSidebar 覆盖。
- **修复建议**：确认后删除。

### P1-2. `SystemPromptBar` onChange 每次按键触发 setSessions 级联
- **来源**：性能
- **文件**：`components/SystemPromptBar.tsx:100-104`
- **问题**：每次按键都调用 onUpdateSettings → setSessions → 完整组件树重渲染。快速打字时 15-30ms/次。
- **修复建议**：仅在 onBlur 或停止输入 300ms 后才调 onUpdateSettings。

### P1-3. `MaskEditorModal` 涂抹只画离散圆点，快速移动时断裂
- **来源**：代码质量
- **文件**：`components/MaskEditorModal.tsx:203-218, 349-353`
- **问题**：`onPointerMove` 只调 `drawDot`，不在两点间画连线，快速涂抹出现断断续续的圆点。
- **修复建议**：记录上一绘制点坐标，用 lineTo 连线。

### P1-4. `retryLastGeneration` 使用过时 customMessages
- **来源**：代码质量
- **文件**：`App.tsx:839-843`
- **问题**：保存了上次调用的 customMessages 快照，重试时不含之后追加的消息。
- **修复建议**：重试时使用当前 session 最新 messages。

### P1-5. `beforeunload` 中 void saveSessions 不保证写入完成
- **来源**：代码质量
- **文件**：`App.tsx:306-319`
- **问题**：IndexedDB 异步写入 + deferLocalSet 也是延迟执行，页面关闭时可能来不及完成。
- **修复建议**：beforeunload 中直接同步写 localStorage 作为紧急备份。

### P1-6. `Sidebar` 未做 memo，每次无关状态变化都重渲染
- **来源**：性能
- **文件**：`components/Sidebar.tsx:26-145`
- **问题**：接收 sessions 数组且无 memo，输入框按键等不相关变化也触发重渲染。
- **修复建议**：React.memo 包裹；toggleSidebar 用 useCallback。

### P1-7. `AssetsModal` exportZip 串行 fetch + 缺错误处理 UI
- **来源**：性能 + 代码质量
- **文件**：`components/AssetsModal.tsx:174-206`
- **问题**：100 张图片串行 fetch 需 ~20 秒；try/finally 无 catch 块，错误被吞。
- **修复建议**：并行 fetch（4-6 并发）；添加 catch 块显示导出失败提示。

### P1-8. `MaskEditorModal` buildMaskDataUrl 逐像素操作 + 两次 toDataURL 阻塞
- **来源**：性能
- **文件**：`components/MaskEditorModal.tsx:228-272`
- **问题**：1792x1024 图片像素遍历 + 两次 PNG toDataURL 总计 60-110ms 阻塞。
- **修复建议**：用 Uint32Array 视图加速像素遍历；用 toBlob 异步编码。

### P1-9. `ModelSwitcherFooter` select 视觉状态在取消确认后不同步
- **来源**：代码质量
- **文件**：`components/ModelSwitcherFooter.tsx:105-122`
- **问题**：用户选新模型后 select 已显示新模型，点取消后 select 仍显示新模型但实际用旧的。
- **修复建议**：使用受控组件模式，pendingModel 存在时 select value 保持为当前模型。

### P1-10. `ModelSwitcherFooter` loadModels/loadBalance 无取消机制
- **来源**：代码质量
- **文件**：`components/ModelSwitcherFooter.tsx:32-82`
- **问题**：组件卸载后 setState 可能被调用；apiConfig 变化与 refreshTick 变化可能同时触发双重 loadBalance。
- **修复建议**：添加 AbortController 或 cancelled 标志；给 loadBalance 加锁/debounce。

### P1-11. `handleDeleteSession` 的 stopPropagation 时机不对
- **来源**：代码质量
- **文件**：`components/Sidebar.tsx:119-123`
- **问题**：window.confirm 同步阻塞期间外层 onClick 可能已触发，导致先切换到要删除的 session。
- **修复建议**：在 confirm 判断前就调 stopPropagation。

### P1-12. `base64ToBlob` 同步 atob 大字符串阻塞主线程
- **来源**：性能
- **文件**：`services/openaiImages.ts:714-719`
- **问题**：1MB base64 约 5-15ms 主线程时间。
- **修复建议**：改用 `fetch(dataUrl).then(r => r.blob())` 异步解码。

### P1-13. `scrollIntoView` 依赖过于宽泛
- **来源**：性能
- **文件**：`App.tsx:337-339`
- **问题**：依赖 `sessions` 引用而非消息长度，设置变更也触发无意义滚动，打断用户阅读。
- **修复建议**：依赖改为 `currentSession?.messages.length`。

### P1-14. `handleVariation` 将 imageUrl 作参考图但不添加到消息 parts
- **来源**：代码质量
- **文件**：`App.tsx:701-715`
- **问题**：聊天记录只有文本 `(变体操作：XXX)`，没有图片 part，用户后续无法知道基于哪张图。
- **修复建议**：在用户消息 parts 中也添加被操作的图片引用。

---

## P2 — 长期优化

### P2-1. App.tsx 过大（~1180 行，25 个 useState），任何状态变化触发全树重渲染
- **来源**：性能
- **文件**：`App.tsx:175-1180`
- **问题**：inputText 每次按键重渲染全组件，约 20-50ms。
- **修复建议**：拆分 ChatInput、AuthProvider、SessionProvider 等子组件/context。

### P2-2. 模特 ID 使用 Date.now()，快速连续操作可能冲突
- **来源**：代码质量
- **文件**：`components/PromptModelPanel.tsx:39`
- **修复建议**：用 uuidv4() 或加随机后缀。

### P2-3. `SystemPromptBar` localPrompt 在 session 切换时可能短暂不同步
- **来源**：代码质量
- **文件**：`components/SystemPromptBar.tsx:21-28`
- **修复建议**：用 `key={currentSessionId}` 强制重挂载。

### P2-4. `allAssets` useMemo 依赖 sessions 引用，任何 session 变化触发全量遍历
- **来源**：性能
- **文件**：`App.tsx:343-376`
- **修复建议**：惰性计算（仅 isAssetsOpen 时）或增量索引。

### P2-5. `hashString` 对 base64 imageUrl 全文遍历
- **来源**：性能
- **文件**：`App.tsx:359`
- **问题**：10 张无 meta.id 的图片 * 1MB base64 = 10M 字符遍历，约 5-15ms。
- **修复建议**：只 hash 前 1000 字符。

### P2-6. 图片代理 `/auth/image-proxy` 全量加载到内存
- **来源**：性能
- **文件**：`server/index.mjs:294`
- **问题**：10 并发请求可能消耗 ~200MB 服务端内存。
- **修复建议**：流式代理 `upstreamResp.body.pipe(res)`。

### P2-7. image-proxy 端点无 Content-Type 验证（SSRF 风险）
- **来源**：代码质量
- **文件**：`server/index.mjs:245-313`
- **修复建议**：验证上游 Content-Type 必须以 `image/` 开头。

### P2-8. `isDisallowedProxyHost` 对 IPv4-mapped IPv6 地址不防护
- **来源**：代码质量
- **文件**：`server/index.mjs:162-180`
- **修复建议**：处理 `::ffff:` 前缀转换为 IPv4 后重新检查。

### P2-9. 全部模态框缺少焦点陷阱和背景滚动锁
- **来源**：代码质量
- **文件**：`ImagePreviewModal.tsx`、`MaskEditorModal.tsx`、`AssetsModal.tsx`
- **修复建议**：实现 focus trap + body overflow:hidden。

### P2-10. `enhancePrompt` 是空操作但 UI 仍显示 loading
- **来源**：代码质量
- **文件**：`services/gemini.ts:9-12`
- **修复建议**：实现真正功能或移除/标记为"即将推出"。

### P2-11. `continuityStories` 数组定义在组件内但未使用（死代码）
- **来源**：代码质量
- **文件**：`App.tsx:853-858`
- **修复建议**：删除。

### P2-12. `quickPromptPresets` 在组件内每次渲染重新创建
- **来源**：代码质量 + 性能
- **文件**：`App.tsx:845-851`
- **修复建议**：移到模块顶层。

### P2-13. `responseFormat` 被硬编码覆盖但 UI 仍提供切换
- **来源**：代码质量
- **文件**：`App.tsx:38, 509`
- **修复建议**：移除死代码 UI 或使用用户选择的值。

### P2-14. SPA fallback 可能拦截 API 404
- **来源**：性能 + 代码质量
- **文件**：`server/index.mjs:363-366`
- **修复建议**：排除 `/api/*` `/auth/*` 路径。

### P2-15. `dataUrlToBlob` 在三个文件中重复实现
- **来源**：性能
- **文件**：`AssetsModal.tsx:47-55`、`imageDownload.ts:13-22`、`openaiImages.ts:714-719`
- **修复建议**：提取为共用工具函数。

### P2-16. `.gitignore` 中 `claude.md` 大小写不匹配 `CLAUDE.md`
- **来源**：代码质量
- **文件**：`.gitignore:25-26`
- **修复建议**：添加 `CLAUDE.md` 条目或用 glob 匹配。

---

## 统计总览

| 来源 | P0 | P1 | P2 | 小计 |
|------|----|----|----|----|
| 代码质量 | 4 | 8 | 10 | 22 |
| 性能 | 4 | 6 | 6 | 16 |
| **去重合并后** | **8** | **14** | **16** | **38** |

### 上轮已修复确认（19 项）

以下 review-findings.md 第一轮的问题在当前代码中已确认修复：

- P0-1 Gemini Chat 串行 → Promise.allSettled
- P0-3 fetch 超时 → withTimeout
- P0-4 删除确认 → window.confirm
- P0-5 触控不可达 → tap-to-toggle
- P0-6 imagesEdits 重试 → retry 循环
- P0-7 abortRef 竞态 → 独立 controller
- P1-1 指数退避 → 2^attempt + jitter
- P1-3 系统指令 onBlur → onChange
- P1-4 401 重登录 → 自动跳转
- P1-5 IndexedDB 断连 → onclose 监听
- P1-6 localStorage 异步 → requestIdleCallback
- P1-7 sessions 防抖 → 400ms debounce
- P1-8 prompt 增强提示 → toast
- P1-9 遮罩编辑提示 + CORS → 错误提示
- P1-10 代理超时 → 90s/95s
- P1-11 Rate limiter 清理 → 定期清理
- P1-12 登出清除 → clearAll()
- P1-13 proxy error handler → headersSent 检查
- P1-14 canvas 对齐 → ResizeObserver
