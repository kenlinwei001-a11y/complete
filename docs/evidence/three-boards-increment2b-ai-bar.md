# 轨M 增量2b · 驾驶舱 AI 栏接 QOS（presetContext·补 G-3）验证

> 母版 §1.A：板块级 AI 对话栏（基于实时数据）。HANDOFF：接 QOS 入口注入 presetContext，不新建聊天。

## 实现（接现有·不新建并行）
- `DashboardView` 加 `DashAiBar`：输入条 + 提问，调 **既有** `useQuickLaunch`（场景启动器同一管线）→ 注入 presetContext{targetView:dash, selectedObjects} → `submitQuery` `POST /b/v1/queries` → 展开对话坞看 SSE。零新聊天组件、零新端点。补断点 **G-3** 前端侧（板块级启动器）。

## FDE（真浏览器·全栈 datacore+agentcore+vite·`m2b-ai-bar.png`）
真登录 /v/dash → AI 栏存在 ✓ → 输入"本月最大风险是什么"提问 →
- **QOS 提交 `POST /b/v1/queries` 已发** ✓，presetContext: `query="本月最大风险是什么" · context.view="dash" · packageId=有`
- **对话坞展开 + 含问句** ✓

## 诚实边界（真答案受 LLM 限·审核方已预判）
- QOS 接线（提交+presetContext 注入+对话坞）**真通**；但 demo agentcore **无 LLM provider** → QOS 任务最终 **FAILED**（path-B agent 无模型可答）。实测 `POST /b/v1/queries` → task ROUTING → FAILED。
- 故口径：**AI 栏接线 + G-3 presetContext 注入真验证；"真编排出答"受 demo LLM 配置限，非接线缺陷**。配 LLM provider 后即真出答（QOS 管线本身轨C/QOS 已验）。
