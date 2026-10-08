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

上下文请求示例：`{refs:[{type:"task",id:"会话ID",includeTranscript:false}],range:{start:毫秒,end:毫秒}}`。type 可为 task/project/report/schedule/goal；最多 40 项、48000 字符。返回 id、fingerprint、text、sources、长度估计、15 分钟有效期。生成请求 `{previewId,fingerprint,question,chatId?}`；中断浏览器 fetch 即停止上游生成，不自动重试。

日程字段：`id?`、`title`、`note`、`start`、`end`、`allDay`、`projectId`、`taskId`、`done`、`reminderMinutes`（0/5/15/30/60/1440）。时间均为毫秒，展示时区 Asia/Shanghai。

用户标记：note、summaryOverride（null 跟随来源）、manualStatus（null 跟随来源）、goalGroup、pinned、branchId。manualStatus 只能用户确认 done，来源待办仅产生 reported_complete；修改备注不改变旧 confirmedAt。

错误 `{error}`；无对象通常 404、格式或配置错误 400、不可信 Host/Origin 403。助手上下文不能传任意文件路径，服务不提供任务执行接口。公开配置中只有 hasPassword / hasKey 标记；Key 仅用于后端认证头。


## 0.3 工作目标与桌面

- `GET/POST /api/goals`：目标分页、创建；支持 project/status/q/attention/page。
- `GET/PATCH/DELETE /api/goals/:id`：详情、修改、删除目标（会话保留）。
- `POST /api/goals/:id/sessions` 与 `DELETE /api/goals/:id/sessions/:taskId`：手动关联同项目会话。
- `GET /api/goals/:id/candidates`：同项目近 30 天候选；`GET /api/tasks/:id/goals`：已关联目标 ID。
- `GET /api/tasks/:id/events`、`GET /api/goals/:id/events`：按时间与 ID 排序，返回 events/nextCursor，cursor 不透明。
- `POST /api/sources/:id/validate`：检查实际记录与结构；`GET /api/diagnostics`：无正文、路径和凭据的状态诊断。
- `POST /api/collection/pause {paused}`：暂停或恢复；`POST /api/reports/refresh`：手动重试本地报告。
- `POST /api/reminders/:id/claim {owner}`：领取 90 秒提醒租约；`POST /api/reminders/:id/ack {claim?}`：确认通知，或用户手动处理。
- SSE `update` 数据包含 type、ids 与 revision。事件提示失联后刷新，客户端不视其为数据库快照。

桌面 API 和静态页面必须带本次启动的 `X-AgentDock-Session`。令牌仅在主进程与独立后端间保存，由主进程注入本应用请求，不放入 URL、前端上下文或日志。普通网页启动保留原本的本机来源检查。

目标 title/projectId/description/note/status/needsReview 单独持久化；status 为 not_started/in_progress/blocked/done/archived，done 设置用户确认时间。会话标记新增 needsReview；回复结束不改变目标状态。

## 0.8.1 聊天只读分页

`GET /api/assistant/chats/:id/messages?before=<位置>&limit=20` 使用现有账号认证，桌面额外保留启动会话认证。省略 `before` 时读取最近消息；`before` 为非负整数，表示读取该位置之前的消息，`limit` 默认 20，支持 1–100。

返回 `id`、`title`、`messages`、`total`、`start`、`end`、`nextBefore`。消息按原顺序排列，位置范围为 `[start,end)`；`nextBefore` 为下一页的 `before`，到达开头时为 `null`。返回正文、状态、来源等消息字段，但省略发送预览 `preview`。不存在的聊天返回 404，非法参数返回 400，未登录返回 401。

接口不修改聊天记录或数据库结构；原完整聊天及上下文快照接口继续保留。客户端首次加载 20 条，每次再读 20 条，最多渲染 100 条，超出窗口的消息可按位置重新读取。


## 0.8.2 个人资料与参考计价

`PATCH /api/account/profile` 继续要求 `displayName`，新增可选 `phone`（32 字）、`email`（254 字）、`gender`（空字符串、female、male、other、private）、`birthday`（1900 年至今天的有效 YYYY-MM-DD）和 `signature`（300 字）。省略字段保留旧值，空字符串清空；名称与资料在同一事务内保存。`GET /api/auth/status` 登录后返回资料，读取不写入数据库；所有者资料使用现有 profile 文档，不用于账号验证。

`GET /api/usage` 新增只读 `defaultPrices`，默认规则带 `default: true`、核查日期、source、tier 和 note。`costs` 区分官方默认与自定义。计价优先采用记录日期适用的自定义规则，其余已核验型号按当前默认价参考换算；默认不是历史有效价，不创建 price 文档。输入包含缓存，先扣除缓存读写，再分别乘单价；长缓存写入按来源记录拆分；输出包含推理，不再追加推理 Token。没有输入输出拆分或未核验型号不计价；USD 与 CNY 分开汇总。

`POST /api/usage/history` 新增可选 `distribution`：weekdays（原工作日分摊，省略保持兼容）或 flexible（弹性分摊，包含部分周末）。配置保留于原历史文档及版本中，按固定日期／模型权重生成估算且严格保持整数总量；不生成实际请求。原始记录、精确补录与实测活跃统计不受影响。

日历建议只在前端生成；采纳仅生成编辑草稿，仍需调用现有 `/api/schedules` 保存才成为日程或触发提醒。
