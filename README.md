# AgentDock · 智能体任务坞

本地 AI 编程任务指挥台。此批更新交付 MySQL 存储、版本化表结构、只读 SQLite 迁移、六类本机来源适配器，以及报告、日程和 DeepSeek 分析的后端接口。配套配置与分析界面在下一批提交中接入。

## 启动与 MySQL 配置

需要 Node.js 24 / 26 和已创建的 MySQL 8.0 / 8.4 数据库。

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

复制 `.env.example` 为 `.env`，完整填写 AGENTDOCK_MYSQL_HOST、PORT、USER、PASSWORD、DATABASE，并配置 TLS / CA。示例为空，不含开发者连接信息。远程默认验证 TLS，本机可关闭。完整环境变量配置优先；未配置时服务仍启动，采集暂停，不回退到 SQLite。

初始化接口 `POST /api/settings/database/initialize` 只创建 ad_ 表和应用版本迁移，不自动建库；连接测试只读。Windows 页面配置接口将凭据用当前用户 DPAPI 加密保存到忽略 Git 的 data/settings.local.json，不回传密码或 Key。旧 data/agentdock.sqlite 经 `POST /api/migration` 只读、幂等迁移，会话 ID、用户标记、确认时间和断点保留，原文件不删除。

## 接入与分析边界

六类来源独立发现：Codex / CLI、Claude / CLI、Cursor、Pi、DeepSeek Harness、WorkBuddy。路径优先级为 AgentDock 环境变量、用户设置、工具原生环境变量、当前用户默认目录。只扫描已知或指定的会话目录，不读取认证文件。

- Codex 索引、当前/归档 JSONL；Claude 项目和子代理日志；Cursor 本机 SQLite 结构，正文缺失明确部分接入。
- Pi JSONL 分支；Harness 普通 JSONL、拼接 Zstandard 帧及文本片段；WorkBuddy 元数据、项目日志和结构化待办。
- 每 3 秒检查、日志监听、断点事务、半行/轮换/截断恢复；原始记录只读。最近活动与整体完成独立，只有用户产生确认完成。
- MySQL 完整日期活动索引用于日报周报；用户编辑与 AI 版本独立保存。日程仅服务和页面运行时提醒。
- DeepSeek 默认官方 API / deepseek-flash。用户选择对象后预览实际上下文，点击生成才发送；Key 仅用于认证头，不进入模型消息。模型不执行任务，模拟测试不调用真实 API。

详细接口、字段和安全边界见 [docs/api.md](docs/api.md)。本地配置、真实记录、凭据和备份排除 Git。新用户可仅使用一种 IDE，自有记录存入自己配置的 MySQL。

## 检查与 CI

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:integration
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

单元测试无需数据库。集成与浏览器测试需要可创建独立 agentdock_test* / agentdock_e2e* 测试库的配置，测试会清理其中的应用表；勿存入业务数据。浏览器使用合成日志、独立端口和模拟模型。

GitHub Actions 在 Windows Node.js 24 / 26 验证解析、DPAPI 与构建；Ubuntu 使用临时 MySQL 8.4 验证集成与浏览器。仅使用合成测试凭据，不连接用户数据库。

React / TypeScript / Vite 前端复用原深空与轨道素材。Fastify / Worker / mysql2 后端仅汇总和分析，不控制 IDE。提交约定见 AGENTS.md：中文说明、同步 README、改动聚焦并复用已有代码。
