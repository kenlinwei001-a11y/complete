# WO-11 · UX/语义裂缝合集（5 子项·P3）— FDE 真值证据

> 判据（HANDOFF §WO-11）：逐条真跑/真渲染——徽章一致 / schema 外部失败可读 / 解绑生效 / F5 不掉登录 / query-history 可达。
> 真跑环境：datacore 内存模式真启动（PORT=4101 SEED_DEMO=1）+ 前端 vitest 真渲染（MSW 真后端语义）。

## 子项 1 · data-health 徽章自相矛盾 → 同口径（无回写）

- **根因**：非 critical 源 lag 超阈仍判 status=OK，但前端按 `latencyMin>thresholdMin` 一律显「⚠超阈」，与「正常」徽章并存矛盾。
- **修**：后端 `DataHealthSource += critical`（`datahealth.ts` 源①下发）；前端 `alarmOver = overThreshold && s.critical !== false` —— 非关键源超阈仅显「（非关键源·参考）」不告警，关键源/已降级超阈才标「⚠超阈」。
- **真渲染**（`test/wo11.ux-gaps.test.tsx`）：关键源 IoT/SCADA(300>120,critical) → `⚠超阈`；非关键源 外部信号(300>120,critical:false) → `（非关键源·参考）` 且 **不含** `⚠超阈`，状态徽章仍「正常」（口径一致）。✅

## 子项 2 · schema 发现裸 500 → 优雅降级（无回写）

- **根因**：`GET /a/v1/connections/:id/schema` 外部源 4xx/网络错 → 适配器裸抛 `Error` → 全局映射成 500 `INTERNAL_ERROR`（不可读）。
- **修**：`connectors/service.ts discoverSchema` try/catch——既有 `AppError`（如不支持格式 400）原样透出；其余包装成可读 502 `CONNECTOR_SCHEMA_DISCOVERY_FAILED`（含连接器名 + 原因）。
- **真跑 curl**（datacore :4101）：建 rest_api 连接指向不可达 URL → `GET …/schema`：
  ```
  HTTP 502
  {"error":{"code":"CONNECTOR_SCHEMA_DISCOVERY_FAILED",
    "message":"连接器「外部行情源」schema 发现失败（上游源不可用或返回错误）：fetch failed","requestId":"…"}}
  ```
  非 500/非 INTERNAL_ERROR，回执可读。✅

## 子项 3 · PUT /llm-bindings add-only → 幂等替换 + DELETE（回写本体 §2 LlmPurposeBinding）

- **根因**：`putBindings` 只 upsert body 中用途、从不删省略的用途，且无 DELETE 路由 → 错绑无法解绑（死绑定）。
- **修**：`PUT` = 幂等替换（body 即用途全集，省略的自动解绑）+ 新增 `DELETE /a/v1/llm-bindings/:purpose`（幂等）；被删用途并入 `llm_binding.updated` 失效集合（B 侧 TTL 60s + 事件失效）。tenant_admin only。
- **真跑 curl**（datacore :4101）：
  ```
  PUT classifier+agent           → bindings=[agent,classifier]
  PUT agent ONLY                 → bindings=[agent]        # classifier 被替换语义解绑 ✅
  DELETE /a/v1/llm-bindings/agent → bindings=[]            # 单用途解绑 ✅
  DELETE 再来一次                 → HTTP 200                # 幂等 ✅
  ```

## 子项 4 · 深链 F5 掉登录 → 启动先静默续期（回写本体 R8）

- **根因**：`ShellLayout` 启动守卫 `if(!tokenStore.get()) navigate("/login")` —— F5 后内存 access token=null 即跳登录，无视有效 refresh httpOnly cookie；丢所在深链位置。
- **修**：守卫先 `silentRefresh()`（导出自 `apiClient`，POST /a/v1/auth/refresh，单飞与 401 重试共享）再判跳登录。**根因解关键**：`useWorkspace` 的 `enabled=tokenStore.get()!=null` 非响应式 → 续期成功后 `setState` 触发重渲染，查询才真拉取（否则深链恒卡「加载中」）；续期失败才跳 /login。
- **真渲染**（`test/wo11.ux-gaps.test.tsx`）：① token=null + refresh 返回 accessToken → 深链 `/admin/source-overview` 真加载（出 `source-overview-page`），**未**落登录页；② token=null + refresh 401 → 落登录页（守卫不误放行）。✅

## 子项 5 · /admin/query-history 孤儿页 → NAV 入口（无回写）

- **根因**：路由 + 组件在（`App.tsx:169`），但 `ADMIN_PAGES`/`ADMIN_NAV_GROUPS` 无入口 → 仅顶栏 🕐 侧滑可达。
- **修**：`adminRegistry.ts` 注册 `query-history`（roles admin/planner/catalog_admin）+ 落「编排与场景」组；`zh.nav.queryHistory="推演历史"`。
- **真验**（`test/f61.admin-nav-groups.test.tsx`）：query-history 在 ADMIN_PAGES + orchestration 组；`groupAdminPages` 后真现于「编排与场景」组、不落「其它」兜底（无孤儿）。既有「所有管理页无遗漏归组」断言仍绿。✅

## 门禁 / 回归

- `pnpm -r build` 绿；datacore 782 / agentcore 351 通过；新增测试：connectors(WO-11.2)、llm-providers(WO-11.3×2)、wo11.ux-gaps(WO-11.1/4×3)、f61(WO-11.5)。
- `pnpm gates` 23 门全绿（含 seed-demo-smoke / ontology-writeback / system-ontology 事件47 一致）。
- 前端全套仅余 **3 个 pre-existing 失败**（f43.admin-cluster ×2 + vle-segment-matrix ×1，均 VLE 运行历史，与 WO-11 无关，待独立核查）——本单未引入任何新失败。

## 本体回写

- §2 LlmPurposeBinding：补「绑定 API 语义（WO-11.3）」PUT 替换 + DELETE。
- §5 R8 认证：补「深链续期（WO-11.4）」silentRefresh 守卫链。
- 子项 1/2/5 纯前端/错误韧性/路由↔NAV 接缝 → 无链路/事件/不变量变更 → 不回写。
