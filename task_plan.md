# 任务计划

## 目标
将“一键出矩阵”升级为独立任务账本流程，不依赖聊天消息，达成：
1. 可追溯：保留任务/槽位/版本/操作日志；
2. 可回收：支持归档/删除（软删除）状态流；
3. 可检索：独立“矩阵记录”入口，可筛选检索与切换；
4. 工作流闭环：矩阵生成不进入聊天区，支持槽位级重跑、下载、局部编辑。

## 阶段
- [completed] 阶段1：数据模型与持久化（types + storage）
- [completed] 阶段2：矩阵生成链路改造（从 chat message 写入改为 batch ledger 写入）
- [completed] 阶段3：独立矩阵记录 UI（侧栏入口 + 任务列表 + 详情）
- [completed] 阶段4：槽位操作闭环（重跑/设主图/下载/局部编辑）
- [completed] 阶段5：联调验证与构建（build + start health）

## 错误记录
| 时间 | 错误 | 处理 |
|---|---|---|
| 2026-02-13 | Coolify 部署崩溃：Express5 下 `app.get("*")` 引发 path-to-regexp 报错 | 改为 `app.use` SPA fallback（仅 GET/HEAD），并通过本地 `/auth/health` 验证 |
