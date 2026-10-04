# AgentDock · 智能体任务坞

本地 AI 编程任务指挥台：汇总 Codex、Claude Code、Cursor、Pi、DeepSeek Harness 和 WorkBuddy 的会话，按项目整理进展、日报与周报，并提供日历日程和带来源的分析助手。

## 0.3 工作台优化

本地接口新增独立工作目标：同项目会话可手动关联，一个会话可参与多个目标；目标状态、备注和用户确认时间单独保存，目标与会话完成数量分别统计。初始化表结构时，旧关联文本按项目迁移为待整理目标，原备注和确认时间保留，可重复执行。

升级后请在设置中点击“初始化表结构”执行版本 3 迁移，只操作 AgentDock 表。服务新增完整活动游标分页、来源记录验证与脱敏诊断；Cursor 根据数据库和 WAL 变化增量检查，每 60 秒兜底复查。今日进展按当日实际活动计数，不将所有未确认会话视为需处理。

界面提供浅色、深色和跟随系统主题，工作目标可在独立页面管理，并加入助手上下文。首页汇总需处理目标、会话及近期日程，首次配置提供引导。完整活动分页、目标与会话详情、筛选状态支持 URL 恢复；未保存的目标、备注、报告或日程修改会提示确认。报告、日历、设置和助手按需加载。今日摘要导出基于当天报告事实，而非全部历史。

## 启动与首次配置

需要 Node.js 24 或 26，以及已创建的 MySQL 8.0 / 8.4 数据库。Windows 是主要验证平台。

```powershell
git clone https://github.com/Guo-Yixin/AgentDock.git
cd AgentDock
npm.cmd ci
npm.cmd run build
npm.cmd start
```

打开 [本地页面](http://127.0.0.1:4317)，进入“设置”填写**你自己的**主机、端口、账号、密码、数据库名和 TLS 配置。先“测试连接”，再“保存并初始化”。测试只执行版本查询；初始化只创建 `ad_` 前缀的 AgentDock 表，不自动建库，不操作其他业务表。

数据库尚不存在时，请在自己的 MySQL 管理工具中执行下面的示例，并按实际情况替换名称、配置访问账号和权限：

```sql
CREATE DATABASE `your_database_name` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

采集与日程功能需要数据库账号具备该库的 SELECT、INSERT、UPDATE、DELETE 权限；初始化还需要 CREATE 权限。推荐专用账号。远程数据库默认开启 TLS 并验证证书及主机名，可填入 CA 证书 PEM；本机连接可关闭 TLS。

**未配置或连接失败时仍能打开网页设置与演示模式，采集暂停，不回退到 SQLite。** 修改数据库目标时先暂停采集，验证、初始化新目标成功后切换，失败保留原配置。连接恢复后从已提交断点继续。

开发模式：`npm.cmd run dev`，打开 [开发页面](http://127.0.0.1:5173)。演示模式：左下角“查看演示体验”，或 [独立演示](http://127.0.0.1:4317/?demo=1)。演示任务和模块使用前端示例，模型回答为模拟，不连接真实数据库或模型 API。

## 配置与凭据保存

Windows 页面保存的数据库密码、DeepSeek Key 使用 **DPAPI 当前用户范围**加密，保存在项目默认 `data/settings.local.json`；该文件独立于 MySQL，首次连接无需访问数据库。换 Windows 用户或迁移到另一台电脑后需重新填写凭据。保存后输入框清空，读取配置接口不回传密码或 Key。

仓库仅提供 [.env.example](.env.example) 空配置；可复制为 `.env` 并填入自己的值。数据库的 HOST、PORT、USER、PASSWORD、DATABASE 五项须完整填写，完整环境变量配置优先于页面设置。环境变量中的密码由运行环境管理，不经过 DPAPI；非 Windows 平台请使用环境变量配置凭据。不要把 `.env` 加入版本控制。

| 变量 | 用途 |
| --- | --- |
| `AGENTDOCK_MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` | 完整 MySQL 连接配置 |
| `AGENTDOCK_MYSQL_TLS` | `true` 验证 TLS；`false` 关闭；不设时远程默认开启 |
| `AGENTDOCK_MYSQL_CA` | CA 证书 PEM 文本，可选 |
| `AGENTDOCK_DEEPSEEK_API_KEY` | DeepSeek Key；也兼容 `DEEPSEEK_API_KEY` |
| `AGENTDOCK_DATA` | 本地加密配置与旧索引所在目录，默认 `data` |
| `AGENTDOCK_HOME` | 替代当前用户主目录，用于独立环境与合成测试 |
| `AGENTDOCK_PORT` | 服务端口，默认 4317；开发代理默认指向 4317 |

`.env`、本地配置、加密凭据、真实记录、备份、截图和测试产物均排除 Git。GitHub 不包含开发者数据库配置或真实模型 Key。服务仅绑定 `127.0.0.1`，校验 Host、Origin 与跨站请求。数据库本身位于用户配置的 MySQL，选择远程 MySQL 时数据会存入该服务器。

## 从旧 SQLite 迁移

设置页检测 `AGENTDOCK_DATA` 目录中的 `agentdock.sqlite`，数据库连接后可点击“迁移旧 SQLite 数据”。迁移只读打开原文件，保留原始会话 ID、用户备注、确认时间与采集断点；可中断后重复执行，不重复插入，不覆盖目标库已有的用户编辑。原 SQLite 文件不删除。

活动历史会由新版解析器重新读取原始工具日志回填；因此完整时间索引需要采集完成。迁移完成后，自有新数据仅写 MySQL。IDE 本身的 SQLite 数据库仍按原格式只读采集。

## 新用户如何接入自己的 IDE

**只安装 Codex 也可以使用。** 六类来源独立发现，没有记录的来源显示“未找到记录”，不阻止其他来源导入。未找到记录不等于工具未安装。软件安装盘符、Windows 用户名和 AgentDock 所在位置都可与开发者不同。

“工具接入”展示实际数据目录、程序入口（可从 PATH 发现时）、发现依据、目录是否存在、记录数量、同步时间和覆盖程度。可修改路径、验证并保存、扫描或停用。读取的是**会话数据目录**，不是可执行程序目录。

例如 Cursor 安装在 `C:\Program Files\cursor` 时，通常仍从 `%APPDATA%\Cursor\User` 读取历史，不应把安装目录填入“数据目录”。新版独立消息按原始会话 ID 去重，支持嵌套工作区 URI；消息缺失继续标为部分接入，重复或仅有会话头的副本不会覆盖已导入的完整正文。

路径优先级：`AGENTDOCK_*_ROOT` → 页面保存路径 → 工具原生环境变量 → 当前用户默认目录。只扫描已知或用户指定的会话目录，不扫描整个磁盘，不读取工具认证文件。

| 来源 | 默认根目录 / 原生环境变量 | AgentDock 覆盖变量与实际覆盖 |
| --- | --- | --- |
| Codex / CLI | `~/.codex` / `CODEX_HOME` | `AGENTDOCK_CODEX_ROOT`；`state_*.sqlite` 会话索引、`sessions` 与 `archived_sessions` JSONL，区分桌面/CLI入口 |
| Claude Code / CLI | `~/.claude` / `CLAUDE_CONFIG_DIR` | `AGENTDOCK_CLAUDE_ROOT`；`projects` JSONL、结构化待办、子代理独立会话 |
| Cursor | 当前用户 `AppData/Roaming/Cursor/User` | `AGENTDOCK_CURSOR_ROOT`；`globalStorage` / `workspaceStorage` SQLite 的 `composerHeaders`、`composerData` 与独立 `bubbleId:*` 消息，按会话头顺序还原正文 |
| Pi CLI | `~/.pi/agent` / `PI_CODING_AGENT_DIR` | `AGENTDOCK_PI_ROOT`；`sessions` JSONL 的消息树与分支，默认最近日志分支明确为推断，详情可选择分支 |
| DeepSeek Harness | `~/.dsh` / `DSH_HOME` | `AGENTDOCK_HARNESS_ROOT`；`sessions` 普通 JSONL 与 `.jsonl.zstd` 拼接帧、压缩文本片段，定位解压行、序号和帧偏移 |
| WorkBuddy | `~/.workbuddy` | `AGENTDOCK_WORKBUDDY_ROOT`；`workbuddy.db` 元数据、`projects` 会话 JSONL 与 `tasks` 待办 |

例如在启动前设置 `$env:AGENTDOCK_CODEX_ROOT = "D:\AI\codex-data"`，填写包含 `sessions`、`archived_sessions` 或会话数据库的根目录。也可在页面保存该目录。CLI 程序未在 PATH 中找到时仍可通过已发现的记录接入。

全部历史指**本机仍保留且能解析的记录**。近期记录优先导入，其余历史后台分批处理，导入期间可以浏览、搜索和打开已入库会话。日志增量采集处理半行、文件轮换与未完成压缩尾帧，监听变化并每 3 秒检查。Cursor 私有结构、未知版本或正文缺失会标记部分接入，不补造内容；单行上限 32 MiB、压缩文件当前上限 128 MiB，超限来源标为不可读。

## 任务、报告与日程

- 首页、项目空间、历史搜索、来源/状态筛选与分页；保留独立会话，同一工具桌面和 CLI 共享原始 ID 时去重。
- 目标、摘要、待办、近期活动和原始证据；详情保留最近 200 条事件并展示最近 40 条，MySQL 完整活动索引用于报告、日历和今日统计，不受此限制。
- 备注、摘要补充、关注、分支选择、人工确认与跨工具“关联工作目标”单独持久化，同步不覆盖。
- 日报按 Asia/Shanghai 自然日，周报按周一至周日；支持项目、来源和历史日期筛选。本地事实只使用当期活动，启动和同步后更新当前报告，近 30 天分批生成，更早日期按需生成。
- 报告区分用户确认完成、来源报告完成与当前阻塞，保留依据；待办标明为当前快照。事实、用户补充和 AI 分析版本分别存储，可导出 Markdown。单次报告当前最多 10 万条活动，超限明确提示缩小范围。
- 月历、周视图、议程列表展示只读工作活动与日报入口；单次日程支持备注、起止、全天、项目/会话关联、完成和提前提醒。
- 页面到期提醒、主动启用的浏览器通知；通知处理状态入库，重启补充仍在有效时间内的未处理提醒。**服务与页面必须运行**，不承诺关闭后提醒；首版不连接外部日历。

Harness 的结构化本轮结束原因会区分完成、阻塞与中断；同一聊天并发生成会被拒绝，避免覆盖历史。回复结束只表示本轮结束；来源待办全部完成只产生“已报告完成”，整体任务由用户确认。不根据聊天数量生成完成百分比，不推断工作时长。来源声称的实现与测试结果不是 AgentDock 独立验证结果。

## DeepSeek 与内置助手

在“设置”输入 Key、选择模型（默认 `deepseek-flash`），可替换、删除、测试连接。使用 [DeepSeek 官方 API](https://api-docs.deepseek.com/quick_start)，连接测试仅查询模型列表，不发送工作记录。没有 Key 时本地采集、报告事实和日程照常使用。

助手可多选会话、项目、日报、周报、日程作为上下文。默认摘要、待办、备注；会话正文需主动勾选，并只包含用户/助手可展示文本，不自动带入内部推理、系统指令或工具输出。项目默认近 30 天，可调整日期。后端按对象 ID 组装数据，不接受任意文件路径。

先“预览实际发送内容”，查看真实内容、来源和长度估计，再“确认内容并发送”。上下文预算 48000 字符，超限需缩小范围；预览 15 分钟有效。每次聊天保留脱敏上下文快照、引用、模型和 token 用量。Key 仅由后端放入认证头，不进入模型消息。回答按脱敏后的安全片段流式显示，可停止、查看/删除聊天，引用可返回对应对象。认证、额度、限流、超时与中断均显式提示，不自动重试可能重复计费的生成。

分析完成后可选择报告，确认保存为独立 AI 版本；也可创建日程草稿，编辑后点击保存才写入。**选中的分析内容会发送至 DeepSeek API**。助手只分析，不执行 IDE 任务或终端命令。

## 检查与 CI

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:integration
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

单元测试无需 MySQL。集成与浏览器测试需要独立测试账号配置（集成权限测试还需要 CREATE USER 与 GRANT 权限，日常应用账号无需这些权限）；测试辅助程序只允许 `agentdock_test*` / `agentdock_e2e*` / `agentdock_ci*` 库名，并清理其中的 AgentDock 测试表，**请勿在这些名称的数据库中存放业务数据**。测试使用独立合成 IDE 日志、模拟 DeepSeek、4318/4319 端口与 `artifacts/e2e` 配置目录，不调用真实模型 API，不修改原工具记录。截图位于 `artifacts/screenshots`。

[GitHub 自动检查](https://github.com/Guo-Yixin/AgentDock/actions/workflows/ci.yml) 在 main 推送、PR 和手动触发时运行：Windows Node.js 24/26 检查解析、DPAPI、类型与构建；Ubuntu Node.js 24/26 使用临时 MySQL 8.4 服务容器验证事务、迁移与 Chromium 界面。CI 只使用合成测试凭据，不连接开发者或用户数据库。浏览器报告、截图与失败跟踪保留 7 天。阻止失败检查的合并需另行设置分支保护。

## 结构与边界

- `src`：React / TypeScript 界面、独立演示模式。
- `server`：Fastify API、Worker、只读来源适配器、MySQL 存储、报告与模型分析。
- `docs/api.md`：接口说明；`docs/design.md`：imagegen 提示词和视觉约定。
- `docs/concepts` 与 `public/assets`：概念图、深空背景和透明轨道装饰。
- `AGENTS.md`：AI 提交前检查规则，提交说明使用中文并审查 README。

网页适配 1440px、1920px 和窄窗口，支持减少动态效果。文字、按钮、图表均为真实组件。任务执行控制、桌面打包、外部日历和编辑器扩展仍在后续范围。
