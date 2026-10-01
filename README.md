# AgentDock · 智能体任务坞

一个只在本机运行的 AI 编程任务指挥台。汇总 Codex、Claude Code 与 Cursor 的本地会话，提供项目聚合、进度提取、原始记录定位、备注、完成确认和 Markdown 导出。

## 启动

需要 Node.js 24 或更新版本（本机使用 Node.js 26 验证）。

```powershell
cd B:\codex_pr\agentdock
npm.cmd install
npm.cmd run build
npm.cmd start
```

打开 http://127.0.0.1:4317 。启动后自动扫描本机记录，近期会话优先导入，其余历史在后台处理。

开发模式：`npm.cmd run dev`，打开 http://127.0.0.1:5173 。

演示模式：页面左下角“查看演示体验”，或访问 http://127.0.0.1:4317/?demo=1 。演示任务单独存放在前端内存，不写入本机索引。

## 已实现

- 首页任务流、项目空间、全历史搜索、来源和完成状态筛选、分页。
- 每个原始会话独立保留；桌面与 CLI 共享同一工具会话 ID 时去重；Claude 子代理日志使用独立身份，避免覆盖主会话。
- 展示目标、提取摘要、结构化待办、近期时间线及文件行号或数据库定位信息。
- 手动状态、摘要补充、备注与关注单独持久化。使用相同“关联工作目标”名称关联多个会话，搜索该名称可检索所有关联会话。
- Markdown 单任务与今日摘要导出；今日统计使用 Asia/Shanghai。
- 后台 Worker 采集与数据库查询；JSONL 增量读取、持久化断点、半行处理、文件缩短/替换检测、自动重试；每 3 秒检查更新，SSE 自动重连。
- 1440px、1920px 与窄窗口布局，键盘搜索 Ctrl/Cmd+K、Escape 关闭详情、详情焦点约束、减少动态效果。

## 支持范围

| 来源 | 当前覆盖 |
| --- | --- |
| Codex / Codex CLI | `~/.codex/state_*.sqlite` 索引及 `sessions` / `archived_sessions` JSONL；来源字段区分入口 |
| Claude Code / CLI | `~/.claude/projects` 下的 JSONL，包括可识别的子代理日志 |
| Cursor | Windows `User/globalStorage` 与 `User/workspaceStorage` SQLite 中的 `composerHeaders`、`composerData` 等本机结构 |
| Pi CLI | 计划第二阶段接入；首版不采集 |
| DeepSeek Harness / WorkBuddy | 等待核实版本与记录来源；首版不采集 |

**完成语义：**回复结束只代表本轮结束。结构化待办全部完成时显示“已报告完成”，不会转成“已确认完成”；只有用户确认会写入自己的完成状态。不根据聊天数量或文件数推算完成百分比。

**提取范围：**标题、首个可识别的用户目标、最新可识别的助手文本、结构化待办。助手陈述的实现或测试结果是来源陈述，不是 AgentDock 独立验证的结果。内部分析、系统指令和工具输出正文不作为摘要来源。

**历史边界：**全部历史指本机仍保留且能解析的记录。Cursor 私有存储结构可能随版本改变，缺少正文或无法解析时明确标记“部分接入”；空草稿不会创建任务。应用保留已经导入的本地索引，不自动删除过去记录。

**时间线边界：**每个会话索引保留最近 200 条可展示事件，详情先显示最近 40 条；今日活动柱状图统计索引中仍保留的事件，不代表所有工具调用次数。原始日志不被裁剪。

## 本地配置

默认读取当前用户目录，可在启动前设置以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `AGENTDOCK_HOME` | 替代用户目录 |
| `AGENTDOCK_CODEX_ROOT` | Codex 数据根目录 |
| `AGENTDOCK_CLAUDE_ROOT` | Claude 数据根目录 |
| `AGENTDOCK_CURSOR_ROOT` | Cursor 的 `User` 目录 |
| `AGENTDOCK_DATA` | 自有数据库目录，默认项目 `data` |
| `AGENTDOCK_PORT` | 服务端口，默认 4317；开发代理仍指向 4317 |

原始日志与数据库始终只读，应用只在自己的数据目录写入索引、断点和用户标记。无需模型 API、账号或云数据库。服务绑定 `127.0.0.1`，检查 Host、Origin 和跨站请求；不提供任意文件读取或任务执行接口。

## 检查

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

浏览器测试使用 `artifacts/e2e` 下的合成数据与独立端口 4318，不修改真实工具记录。测试截图位于 `artifacts/screenshots`，失败跟踪位于 `artifacts/browser-results`。

## 设计与结构

- `src`：React / TypeScript 前端，显式分离演示数据。
- `server`：Fastify 本地 API、采集 Worker、适配器、SQLite 索引。
- `docs/concepts`：首页与详情概念图。
- `public/assets`：生成的深空背景与透明轨道装饰。
- `docs/design.md`：完整 imagegen 提示词与视觉约定。
- `docs/api.md`：本地接口说明。

四张图片均由内置 imagegen 生成；界面文字、按钮、状态、图表均为实际组件。透明轨道 PNG 的 alpha 通道已验证。
