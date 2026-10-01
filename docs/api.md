# 本地接口

默认服务：`http://127.0.0.1:4317`。前端与 API 同源使用；开发服务器 5173 通过 Vite 转发 `/api`。所有数据库查询与扫描在 Worker 中执行。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | 服务版本与 Worker 健康状态 |
| GET | `/api/overview` | 统计、项目、来源覆盖、每小时索引事件和导入进度 |
| GET | `/api/projects` | 按工作目录 / Git 归属聚合的项目 |
| GET | `/api/sources` | 适配器状态、覆盖说明与实际路径 |
| GET | `/api/tasks` | 分页会话列表 |
| GET | `/api/tasks/:id` | 会话、最近事件与用户标记 |
| PATCH | `/api/tasks/:id` | 修改 AgentDock 自己的用户标记 |
| GET | `/api/export` | 今日 Markdown 摘要；`?task=:id` 导出单任务 |
| GET | `/api/events` | SSE，`update` 提示客户端重新查询；3 秒重试、15 秒心跳 |

列表参数：`q`（字面文本检索）、`provider`、`project`、`status`、`page`（从 1 开始，每页 30）、`recent=true`（近 30 天）。结果 `{ tasks, total, page, pageSize }`，按原始最近活动时间排序。

统一会话字段见 `src/types.ts`。唯一身份由工具 provider 与原始会话 ID 组成，使用入口 surface 不参与去重。Claude 子代理的原始会话 ID 补充子代理身份，保留父会话 ID。证据包含原始文件 path、可用时的 line，以及 SQLite 记录 locator。

用户标记：`note`、`summaryOverride`（null 恢复来源摘要）、`manualStatus`（null 跟随来源）、`goalGroup`（同名关联目标）、`pinned`。来源完成状态与用户状态独立保存。`done` 只由用户标记产生；来源结构化待办仅能产生 `reported_complete`。确认时间独立保存，修改备注不会把旧任务重新计入今日完成。

未找到任务返回 404，格式错误返回 400，非本机 / 不可信来源返回 403。错误响应为 `{ error }`。外部路径不是任何写接口的参数，服务不能修改原始工具日志。

适配器目前使用只读本机文件、目录发现及增量同步。Claude / Cursor 官方 Hooks 适合后续增强实时事件精度：

- https://code.claude.com/docs/en/hooks
- https://cursor.com/docs/hooks

Codex 官方 app-server 也提供会话分页接口；首版使用本机记录，不接管正在运行的会话：

- https://learn.chatgpt.com/docs/app-server
