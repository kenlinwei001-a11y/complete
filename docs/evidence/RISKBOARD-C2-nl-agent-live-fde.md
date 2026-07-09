# RISKBOARD-RULES-AGENTS C2 · 活栈 NL-agent FDE 证据（真 Kimi kimi-k2.6·2026-07-09）

> 用户提供 Kimi key·真起 datacore(4001·SEED_DEMO·KIMI_API_KEY 配 provider+6用途绑定) + agentcore(4102)·真连 api.moonshot.cn。key 仅作临时 env·**不入任何提交物**(R5)。

## 代表问经 QOS NL 真路由 → 真 agent 答出（非 LLM_PURPOSE_UNBOUND·非 mock）

- **问句**：「常州基地影响哪些订单？」(view=risk)
- **真 Kimi 分类器**路由 → status=COMPLETED · path=WORKFLOW · matchedIntent=affected_orders · trustLevel=VERIFIED_WORKFLOW
- **答出真订单数据**（demo 真对象·非合成冒充）：

| 订单号 | 客户 | 型号 | 数量 | 交期 |
|---|---|---|---|---|
| SO-3391 | 整车厂A | 4680-NCM | 8 | 2026-06-24 |
| SO-3445 | 整车厂B | 方形-NCM | 11 | 2026-07-05 |
| SO-3490 | 海外车企E | 4680-NCM | 13 | 2026-07-06 |
| SO-3420 | 海外车企E | 4680-NCM | 10 | 2026-07-09 |
| SO-3481 | 整车厂A | 4680-NCM | 10 | 2026-07-11 |
| SO-3476 | 储能集成商D | 4680-LFP | 8 | 2026-07-20 |

- 受影响订单共 6 张·带 provenance ref(prov_…)·方法论口径确定性组装(非模型注入)。

## 验证意义
- **RISKBOARD C2「NL 提问经真 agent 答」活栈生效**：真 Kimi 全链(分类→路径A工作流→invoke_solver affected_orders→答案投影)出真订单表·非 LLM_PURPOSE_UNBOUND。
- **连带活证 LLM-ROLE-RESOLUTION-FIX**：classifier/agent 绑定经跨角色兜底解析到 Kimi provider·真调用成功(非「已绑仍报未绑」)。
- **连带活证 CORE-NL-SOLVER-ROUTING / FILL-AUDIT-OBS-LINE 的 NL 真路由**(此前 mock LLM·此处真 Kimi 复证)。

## 诚实边界
- 本证据为 **API 级活栈 FDE**(真起双服务真连 Kimi·真终态真数据勾稽)。
- C2 的**真浏览器点卡下钻截图** + C3 徽章视觉·属前端渲染层(下钻/徽章代码基建已在·数据源 C1 已绿)·可 Playwright 补(Chromium 预装)。