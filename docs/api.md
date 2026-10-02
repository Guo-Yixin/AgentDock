# 本地接口

默认 `http://127.0.0.1:4317`；开发页面 5173 经 Vite 代理。Worker 执行存储查询、采集和报告生成，MySQL 参数化查询；原工具文件只读。未配置数据库时 health、settings、来源发现、演示和空列表可使用。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health`、`/api/settings` | 连接状态与公开配置，不返回密码/Key |
| POST | `/api/settings/database/test` | 只读连接与版本测试，不初始化 |
| POST | `/api/settings/database` | 验证、初始化新目标后保存 DPAPI 配置 |
| POST | `/api/settings/database/initialize` | 初始化当前配置的 ad_ 表 |
| GET / POST | `/api/migration` | 旧 SQLite 迁移状态 / 可重复迁移 |
| POST | `/api/settings/model`、`/api/settings/model/test` | 保存 Key/模型；仅查询模型列表的测试 |
| DELETE | `/api/settings/model/key` | 删除本地加密 Key（环境变量须自行移除） |
| GET | `/api/sources/discover`、`/api/sources` | 来源发现 / 采集健康与覆盖 |
| PATCH | `/api/sources/:id` | 保存绝对数据根目录与 enabled；环境变量优先 |
| POST | `/api/sources/scan` | 启动扫描，进度经 overview / SSE 展示 |
| GET | `/api/overview`、`/api/projects` | 统计、聚合项目与导入进度 |
| GET | `/api/tasks`、`/api/tasks/:id` | 分页列表 / 详情与用户标记 |
| PATCH | `/api/tasks/:id` | 备注、摘要补充、完成、关联、关注、Pi 分支 |
| GET | `/api/export` | 今日摘要；`?task=:id` 单任务 Markdown |
| GET / POST | `/api/reports` | 报告列表 / 按 kind,date,project,provider 生成事实 |
| GET / PATCH | `/api/reports/:id` | 详情 / userText 人工补充 |
| GET | `/api/reports/:id/export` | Markdown 事实、补充与 AI 版本 |
| POST | `/api/reports/:id/analysis` | 以 chatId 选择已完成回答，用户确认保存 AI 版本 |
| GET / POST | `/api/schedules` | 日程列表 / 创建或更新 |
| DELETE | `/api/schedules/:id` | 删除日程 |
| GET | `/api/calendar?start=&end=` | 最多 62 天活动（毫秒）及日程 |
| GET | `/api/reminders` | 未处理的有效到期提醒 |
| POST | `/api/reminders/:id/ack` | 持久化处理状态 |
| POST | `/api/assistant/context` | 按对象 ID 构建、脱敏、保存发送预览 |
| GET | `/api/assistant/chats`、`/api/assistant/chats/:id` | 聊天历史与上下文快照 |
| DELETE | `/api/assistant/chats/:id` | 删除聊天 |
| POST | `/api/assistant/generate` | 校验预览后向 DeepSeek 请求；流式 chat/delta/done/error |
| GET | `/api/events` | 更新 SSE，3 秒重试、15 秒心跳 |

任务列表参数：`q` 字面检索、`provider`、`project`、`status`、`page`（从 1 开始，每页 30）、`recent=true`。列表筛选、分页与日期活动查询在 MySQL 执行。

上下文请求示例：`{refs:[{type:"task",id:"会话ID",includeTranscript:false}],range:{start:毫秒,end:毫秒}}`。type 可为 task/project/report/schedule；最多 40 项、48000 字符。返回 id、fingerprint、text、sources、长度估计、15 分钟有效期。生成请求 `{previewId,fingerprint,question,chatId?}`；中断浏览器 fetch 即停止上游生成，不自动重试。

日程字段：`id?`、`title`、`note`、`start`、`end`、`allDay`、`projectId`、`taskId`、`done`、`reminderMinutes`（0/5/15/30/60/1440）。时间均为毫秒，展示时区 Asia/Shanghai。

用户标记：note、summaryOverride（null 跟随来源）、manualStatus（null 跟随来源）、goalGroup、pinned、branchId。manualStatus 只能用户确认 done，来源待办仅产生 reported_complete；修改备注不改变旧 confirmedAt。

错误 `{error}`；无对象通常 404、格式或配置错误 400、不可信 Host/Origin 403。助手上下文不能传任意文件路径，服务不提供任务执行接口。公开配置中只有 hasPassword / hasKey 标记；Key 仅用于后端认证头。
