# PRD: VEO 3.1 首尾帧视频生成功能

## 1. Introduction / Overview

为产品新增一个独立的“视频生成”工作流，使用 `veo3.1` 模型，支持用户基于首帧、可选尾帧和文本提示词生成短视频。该功能入口放在首页主导航中，与现有图片生成能力并列。

本功能要解决的问题是：当前系统只有图片生成能力，用户无法直接在平台内完成“静态素材到动态视频”的创作链路。首版应聚焦于跑通核心主链路，让用户可以完成提交、等待、预览、下载和重新生成，并保留基本的历史记录。

## 2. Goals

- 提供独立的视频生成入口，不依赖现有图片生成页面才能访问。
- 支持 `veo3.1` 视频生成，输入包含首帧、可选尾帧和文本提示词。
- 允许用户在一次任务中选择生成 1 到 4 条候选视频。
- 提供基础参数控制：时长、比例、分辨率。
- 提供视频历史记录、结果预览、下载、删除和重新生成能力。
- 保持首版范围可控，不引入剪辑、字幕、配音或复杂视频编辑能力。

## 3. User Stories

### US-001: 新增视频生成入口
**Description:** As a user, I want to see a dedicated video generation entry in the main navigation so that I can start a video workflow directly.

**Acceptance Criteria:**
- [ ] 首页主导航新增“视频生成”入口，并与现有图片生成功能并列展示
- [ ] 点击入口后进入独立的视频生成页面，而不是复用图片生成页面
- [ ] 页面初始状态可看到素材上传区、提示词输入区和基础参数区
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-002: 支持首帧、可选尾帧和文本提示词提交
**Description:** As a user, I want to upload a required start frame, optionally upload an end frame, and enter a text prompt so that the model has enough guidance to generate a video.

**Acceptance Criteria:**
- [ ] 首帧为必填项，未上传时不能提交
- [ ] 尾帧为可选项，未上传时仍允许提交任务
- [ ] 文本提示词为必填项，空提示词时显示明确校验提示
- [ ] 尾帧上传区域明确说明“可选，但有助于控制收尾画面”
- [ ] 表单提交 payload 中包含首帧、可选尾帧和提示词字段
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-003: 配置基础视频生成参数
**Description:** As a user, I want to control only the essential generation settings so that I can generate suitable videos without dealing with overly complex options.

**Acceptance Criteria:**
- [ ] 支持设置视频时长
- [ ] 支持设置视频比例
- [ ] 支持设置视频分辨率
- [ ] 支持设置生成数量，允许值为 1 到 4
- [ ] 参数选择有默认值，初次进入页面时无需手动填写全部字段
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-004: 提交单次多候选视频任务
**Description:** As a user, I want to request multiple candidate videos in one submission so that I can compare several outputs in one round.

**Acceptance Criteria:**
- [ ] 单次提交可以请求 1 到 4 条候选视频
- [ ] 提交后前端展示任务创建成功状态，并显示任务处理中信息
- [ ] 如果后端或模型返回部分失败，界面能区分成功结果与失败结果
- [ ] 如果任务提交失败，界面展示可理解的错误信息，不丢失用户已填写表单
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-005: 展示视频历史记录
**Description:** As a user, I want to see my past video generation tasks so that I can revisit, compare, and manage previous outputs.

**Acceptance Criteria:**
- [ ] 视频生成页面包含历史记录区域
- [ ] 每条历史记录至少显示缩略预览或占位、创建时间、状态、提示词摘要和生成数量
- [ ] 历史记录仅展示当前登录用户自己的任务
- [ ] 页面刷新后历史记录仍可从后端重新拉取
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-006: 预览、下载、删除和重新生成视频
**Description:** As a user, I want to preview, download, delete, and rerun a generated video so that I can manage usable and unusable outputs efficiently.

**Acceptance Criteria:**
- [ ] 每个成功生成的视频都支持在线预览
- [ ] 每个成功生成的视频都支持下载
- [ ] 每条结果或任务都支持删除，并在删除前进行确认
- [ ] 支持基于已有任务参数执行重新生成
- [ ] 重新生成时默认带回原任务的提示词、图片和基础参数
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-007: 对接 veo3.1 后端生成链路
**Description:** As a developer, I want a stable backend integration for `veo3.1` so that the frontend can submit generation jobs and query results consistently.

**Acceptance Criteria:**
- [ ] 后端提供视频生成任务创建接口
- [ ] 后端提供视频任务查询或结果获取接口
- [ ] 后端请求参数与 `veo3.1` 所需字段完成映射
- [ ] 对模型返回的任务状态、结果地址和错误信息进行规范化
- [ ] 无尾帧场景和有尾帧场景都能正确映射到模型请求
- [ ] Typecheck/lint passes

### US-008: 持久化视频任务与结果
**Description:** As a developer, I want video task data stored persistently so that history, preview, and downloads remain available across sessions.

**Acceptance Criteria:**
- [ ] 新增视频任务与视频结果的数据存储结构
- [ ] 至少保存任务输入参数、任务状态、结果地址或本地引用、错误信息和时间戳
- [ ] 历史查询接口返回的数据足以支撑前端历史列表和详情展示
- [ ] 删除任务时相关结果数据按设计同步删除或标记删除
- [ ] Typecheck/lint passes

## 4. Functional Requirements

1. FR-1: 系统必须在首页主导航中新增一个独立的“视频生成”入口。
2. FR-2: 视频生成页面必须包含首帧上传、尾帧上传、文本提示词输入和基础参数设置区域。
3. FR-3: 系统必须要求用户上传首帧后才能提交视频生成任务。
4. FR-4: 系统必须允许用户在未上传尾帧时提交任务。
5. FR-5: 系统必须要求用户填写文本提示词后才能提交视频生成任务。
6. FR-6: 系统必须支持以下基础参数：视频时长、视频比例、视频分辨率、生成数量。
7. FR-7: 生成数量必须允许用户在 1 到 4 之间选择。
8. FR-8: 系统必须使用 `veo3.1` 作为该功能首版的视频生成模型。
9. FR-9: 后端必须将前端提交的首帧、可选尾帧、提示词和基础参数转换为 `veo3.1` 可接受的请求格式。
10. FR-10: 系统必须支持单次任务返回多条候选视频结果。
11. FR-11: 系统必须为每个视频任务记录任务状态，至少包含待处理、处理中、成功、失败。
12. FR-12: 系统必须提供视频历史记录查询能力，且默认只返回当前登录用户自己的记录。
13. FR-13: 系统必须支持对成功生成的视频进行预览和下载。
14. FR-14: 系统必须支持删除历史任务或视频结果。
15. FR-15: 系统必须支持基于历史任务参数执行重新生成。
16. FR-16: 重新生成时，系统应自动回填原任务的首帧、尾帧、提示词和基础参数。
17. FR-17: 当任务创建或查询失败时，系统必须返回清晰的错误信息给前端。
18. FR-18: 当前端提交非法参数时，系统必须在前后端都进行校验并阻止任务创建。

## 5. Non-Goals (Out of Scope)

- 不做视频剪辑能力。
- 不做字幕生成或字幕编辑能力。
- 不做配音、音频合成或背景音乐能力。
- 不做多个视频片段拼接能力。
- 不做批量视频任务编排或大规模批处理工作流。
- 不做高级控制参数，如随机种子、复杂镜头轨迹、精细运动路径控制。
- 不做多模型切换，首版固定为 `veo3.1`。

## 6. Design Considerations

- 入口在首页主导航，视觉层级应与现有主能力一致，不应作为隐藏二级入口。
- 页面结构建议按“素材上传 -> 提示词 -> 参数 -> 提交 -> 历史记录/结果”展开，降低学习成本。
- 尾帧上传区需要明确标注为“可选”，但应提示用户提供尾帧通常能更好控制视频收尾效果。
- 历史记录中的单条结果应能直接完成预览、下载、删除和重新生成，不要求用户进入复杂详情页才能操作。
- 若已有图片上传、任务列表、媒体预览组件，可优先复用，但不应牺牲视频场景下的信息完整性。

## 7. Technical Considerations

- 需要新增后端视频任务接口，或在现有代理/服务层中增加面向 `veo3.1` 的视频生成适配逻辑。
- 需要确认 `veo3.1` 的入参格式，特别是首帧、尾帧、文本提示词、时长、比例、分辨率和候选数量字段。
- 需要新增数据库表或扩展现有数据结构，用于存储视频任务元数据与视频结果。
- 视频文件通常体积较大，需要明确结果存储策略：直接保存上游结果 URL、转存本地、或混合方案。
- 如果上游生成是异步任务模式，需要实现轮询、状态同步或回调后的状态刷新机制。
- 需要评估视频任务对系统资源和额度的影响，虽然首版未把“成本/额度控制”设为主目标，但要为后续配额保护预留扩展点。
- 需要确认下载链路的权限控制，避免用户访问到其他人的视频结果。

## 8. Success Metrics

- 用户可以从首页在 1 次点击内进入视频生成页面。
- 用户可以成功完成“上传首帧、填写提示词、可选上传尾帧、提交任务”的完整流程。
- 单次任务可稳定返回 1 到 4 条候选视频结果。
- 用户可以在生成完成后完成预览和下载，无需离开当前工作流。
- 页面刷新后仍能看到自己的历史视频任务。
- 首版上线后，不因该功能引入明显的登录、图片生成或历史记录回归问题。

## 9. Open Questions

- `veo3.1` 当前可稳定支持的时长、比例和分辨率选项有哪些，需要按模型真实能力收敛 UI 选项。
- 单次 1 到 4 条候选视频是由模型原生支持，还是需要后端拆分为多个子任务实现。
- 视频结果是否要转存到本地存储，还是直接使用上游返回地址。
- 历史记录是否需要按“任务”分组展示，还是按“单个视频结果”平铺展示。
- 重新生成是否默认复用原首帧/尾帧文件引用，还是要求重新确认素材有效性。
- 首版是否需要展示生成进度百分比，还是只展示状态文本即可。
