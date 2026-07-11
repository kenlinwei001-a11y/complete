# S1 · 真浏览器 E2E 证据（补真·审计严重度 2/3 根因·2026-07-11）

回应自我审计严重度 2（"机制搭好但功能不能用"·shock 前端未真跑）+ 严重度 3（"真浏览器从头到尾没跑过"）。
真起双服务（datacore:4001 SEED_DEMO·agentcore:4002）+ 真 chromium（`/opt/pw-browsers/chromium-1194`·playwright-core）
+ 真 vite（指向真后端·`VITE_DATACORE_URL/VITE_AGENTCORE_URL`·CORS 放行）+ 真登录（admin/demo1234·JWT）。
脚本 `s1-browser.mjs`。截图 `S1-sandbox-realbrowser.png`。

## 逐条真跑输出（ALL PASS）
```
✓ 真后端取 Line 对象: obj_line_LINE-changzhou（真 sim view-config）
✓ 登录成功(离开登录页)                                          ← 真后端真 JWT
✓ 真浏览器渲染出沙盘(sandbox-view·渲染器落地)                     ← registerRenderer("sim-sandbox") 真浏览器验证
✓ auto-tick 推进到 tick=5(shock 真跑传导·非静止页)·UI cur-tick=5   ← shock 真接通（严重度2根因闭合）
✓ 全局 KPI 真值(传导产状态级结论): 47.7                          ← 传导真跑出状态级结论
✓ 逐值对照:UI cur-tick(5) == 后端会话推进 tick(5)                ← UI 逐值==真后端会话态（铁律0.4）
```

## 截图确认（真 UI·非 jsdom）
`S1-sandbox-realbrowser.png`：真浏览器渲染出「推演沙盘·一页看全」；**what-if 上下文条明示「来自决策入口:dialogue · 真浏览器 shock 推演 · obj_line_LINE-changzhou」**——证对话触发 SimulationRequest（source=dialogue）被真消费、沙盘按问句对象起跑。

## 端到端链路覆盖（每段真验证的方式·诚实标注）
| 链路段 | 验证方式 | 证据 |
|---|---|---|
| NL 问句 → 分类命中时序意图 → sandbox_render 答案块（逐值） | 真起双服务 HTTP E2E | `S1-SANDBOX-AS-RENDER-TARGET-e2e.md`（shock 逐值/hold 诚实/关闸回退 ALL PASS） |
| sandbox_render 块渲染 + 「打开推演沙盘」按钮落 scenarioPreset + 导航 | jsdom 组件测 | `sandbox-render-block.test.tsx`（2 测·registerRenderer 解析 + preset 落库逐值） |
| **沙盘渲染器在真浏览器渲染 + 消费 preset + 对真后端跑 shock 传导 + 逐 tick 状态级结论 + 逐值对照后端** | **真 chromium + 真后端** | **本文（cur-tick 逐值/KPI 真值/截图）** |
| shock 烘 tick0 + auto-tick + 诚实守卫 | jsdom 组件测 | `sandbox-shock-run.test.tsx`（3 测·base[对象].load 逐值含 delta/simTick N 次/ghostVar 不注入） |

## 诚实边界
- 环境无 LLM provider → 真 NL classify 用 `QOS_CLASSIFY_FUSE=1`+低 tau 让确定性分类器（`classify-preview` 实测把 sim.shock_whatif 判为 top·0.24）路由 Path A。**生产 classify 精度依赖 LLM/兄弟单A**（WO §1.3/§3.3 明示依赖）——非本 S1 渲染机制。
- 真浏览器 preset 注入用 dev-only `window.__PENDING_SIM_PRESET__`（`import.meta.env.DEV` 守卫·生产构建不含），等价 sandbox_render 按钮落 preset；按钮 UI 渲染+点击+导航由 jsdom 测覆盖、后端 NL→答案由 HTTP E2E 逐值覆盖。三段拼起来即全链，无 mock 冒充真值。
