# 0.8.2 默认单价依据

核查日期：2026-10-08。默认单位为每百万 Token，币种随提供商保留，不自动转换汇率。以下均为官方来源，目录保存在 `server/price-catalogue.mjs`。

- [OpenAI 官方价格](https://developers.openai.com/api/docs/pricing)：GPT-6 Astra、GPT-6.1 Sol、GPT-6 Luna 与 GPT-5.6 Sol 的输入、输出、缓存读写及长上下文档位；其他型号引用各自官方模型页，包括 GPT-6 Sol、GPT-5.6 Luna／Terra、GPT-5.5、GPT-5.4、GPT-5.3 Codex 与 GPT-5.2。默认采用标准短上下文，不把会话累计 Token 当成单次请求上下文长度。
- [Claude 官方价格](https://platform.claude.com/docs/en/about-claude/pricing)：分别记录模型输入、输出、5 分钟与 1 小时缓存写入、缓存命中。Sonnet 5.5 的命中价修正为 0.10 USD/M；Haiku 5.5 保留 100K 上下文档位。缓存写入已包括在归一化输入内，不重复相加。
- [DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)：Flash 与 V4 Pro 的峰谷价格分开。默认采用高峰参考价，非高峰可另存规则；不自动推断法定节假日或服务端接收时间。官方确认 V4 Flash 与 V4 Flash Vision Exp 旧 ID 由 Flash 服务，使用此明确映射，未确认标签不猜价。
- [Cursor 官方价格](https://cursor.com/docs/models-and-pricing)：Cursor 路由的 Composer、Grok、Gemini 与其他模型按该平台公开表引用；同名 Google 直连与 Cursor 路由可以有不同输出价格，按工具区分。
- [Google 官方价格](https://ai.google.dev/gemini-api/docs/pricing)：Gemini 3.8 Flash 当前标准促销输出价为 3.75 USD/M，注明截至 2026-12-31；3.5 Flash 与 Flash Lite 单独记录。缓存存储时长、搜索工具费未包含在 Token 估算。
- [SpaceXAI 官方模型页](https://docs.x.ai/developers/models)：Grok 4.7 输入／输出价；该页未明确缓存价格，缓存暂按普通输入估算，目录注明此假设。
- [腾讯 TokenHub 官方价格](https://cloud.tencent.com/document/product/1823/130055)：广州后付费 Hy3、Hy4 preview 和 DeepSeek V4.1 Flash 的输入、输出及缓存命中；默认使用广州／高峰参考价。它是 API 等值参考，不能换算为 WorkBuddy 积分消耗或订阅实际费用。旧混元型号保留[腾讯云原平台目录](https://cloud.tencent.com/document/product/1729/97731)来源。

默认价格是只读、当前价格快照，不写入用户单价表。用户自定义规则按生效日期优先；早于自定义生效日期的记录采用当时可用的自定义旧规则，否则显示当前公开价参考换算，不能作为历史账单。未知型号、自动路由而未报告型号、缺失输入输出的数据和比例补录均不猜价。不同币种不相加，来源 SDK 金额独立显示。

本机型号只进行了只读核对。未找到可核验公开价的 `codex-auto-review`、未知模型和合成测试标签保持未计价；没有修改模型标签、原始会话、采集用量或用户已有单价。
