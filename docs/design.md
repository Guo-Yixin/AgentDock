# AgentDock visual direction

Built-in imagegen is used for two concept previews and two production raster assets.
Concept screenshots are reference images only; interface text, controls, timelines and charts are implemented as React components.

Original concept palette: midnight #080d16, panel #101824, mint #72e4bc, muted blue-gray #8290a4.
Layout: narrow left navigation, broad central workspace, compact right briefing. Chinese interface with restrained English micro-labels.
Motion: brief fades and card expansion; disable decorative motion for prefers-reduced-motion.

## Prompts

### Overview concept
High-fidelity desktop web UI mockup for AgentDock, a local AI coding task command center. Wide 16:10 canvas, flat straight-on UI screenshot, no device frame. Dark midnight navy, fine gray-blue dividers, crisp readable Chinese typography, restrained mint accents. A slim left sidebar with AgentDock wordmark, navigation 总览 / 项目 / 历史记录 / 工具接入 and source chips Codex, Claude Code, Cursor. Large central title 任务指挥台, understated subtitle 每一个任务，都有迹可循. Header has a sparse elegant mint orbital artwork at the right, not behind body text. Three horizontal metrics 近期活动 / 待你处理 / 今日进展. Center contains high-density task rows with source tags, repository name, status and timestamp. Right briefing rail has 今日简报, source health, and tiny activity bars. Editorial hierarchy, generous margins, narrow rounded corners, professional developer productivity software. No giant glowing dashboard gauges, no excessive glass effects. Demo data only.

### Detail concept
High-fidelity desktop web UI screenshot for AgentDock in the same midnight navy and restrained mint visual system. Wide 16:10, straight-on, no device. Narrow sidebar, central task feed visible, a large right-side task detail panel open. Panel title 修复任务状态同步, source Codex, repository agentdock. Sections 任务目标 / 提取摘要 / 待办事项 / 活动时间线 / 来源依据 / 我的备注. Mint timeline points, readable pale gray Chinese text, thin blue-gray dividers, compact buttons 保存备注 / 导出摘要. Explicit labels 本轮回复已结束 and 任务完成待确认. Subtle orbital art confined to top header; professional practical engineering interface, refined spacing, no giant charts. Demo data only.

### Deep-space background
Production background texture for AgentDock developer dashboard header, wide landscape. Near-black midnight navy #080d16 with extremely subtle blue nebula haze and very sparse pinprick stars, slight mint atmospheric glow concentrated on far right edge. Large quiet negative space across left and center for live UI text. Elegant restrained deep-space aesthetic, low contrast, no text, no logos, no planets, no cards, no interface elements, no watermark.

### Transparent orbital decoration
Production transparent PNG decorative orbital sculpture for AgentDock dashboard header. A single delicate 3D arrangement of three intersecting elliptical metallic mint rings around a tiny luminous mint point, fine etched ticks and a few small satellite dots. Refined scientific instrument, asymmetrical elegant perspective, muted mint and desaturated steel blue, very restrained bloom. Isolated cutout with genuine alpha transparency, no background, no ground plane, no text, no logo, no watermark; clean edges. Decoration must remain legible at small size.


## 0.3 工作台界面

当前产品采用浅色、深色与跟随系统三套语义颜色，保留青绿状态色，移除首页深空背景及轨道装饰。原 imagegen 概念图与提示词保留作历史参考，不代表当前界面截图。

导航依次为工作台、工作目标、项目空间、历史记录、报告、日历和助手；来源与设置置于导航末尾。首页显示明确需处理事项、目标与近期日程。没有可靠分母时只显示完成数量。页面按需加载，筛选、会话详情和目标写入 URL，支持刷新与浏览器返回。用户未保存修改时提示保留或放弃。
