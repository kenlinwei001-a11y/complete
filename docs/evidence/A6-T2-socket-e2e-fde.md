# A6-T2 · A6 拟真值域真 HTTP socket e2e 固化为回归（P3）— FDE 证据

> 来源：`REVIEW-A6-tails-verdict.md` §尾巴② / `DEV-TODO-reviewer-open-items.md` §3。
> 核发现状：A6 尾巴② 功能闭合（审核方真 socket 手跑复现值逐位吻合），但**真 socket 路径无自动回归**——唯一自动化 `a6-value-domains.test.ts` 用 `app.inject`（进程内，正是文档说"非"的那个），真 TCP 栈回归 CI 抓不到。

## 缺口（核发原文）

- A6 提交未增任何测试；真 HTTP socket 是 dev 手跑 curl + 审核方手跑复现，非提交物自动化。
- HTTP 栈（路由/序列化/中间件/JSON 编解码）若回归，CI 不会抓到。

## 修法（根因解·非"改文档标手测"）

判据给了两条路：① 补真 listen e2e；② 退而把文档标"手测复现"。**取 ①**（治本）：

- 新增 `apps/datacore/test/a6-e2e-socket.test.ts`：`app.listen({port:0})` 真起 TCP 监听 + `fetch` 真打（非 `app.inject`），仿 `opt-real-sidecar.integration.test.ts` 真 socket 范式，但**自包含、无外部依赖、不 env-gate**（默认随 `pnpm --filter datacore test` 跑）。
- **dogfood 提交物**：直接复用 `seedA6ReferenceTemplate`（= `SEED_A6_DEMO=1` 启动跑的同一函数），不内联重复模板——回归同时守护"真种子"。
- 断言对齐核发判据：util 落业务区间 `[0.62,0.95]`（≥8/12）+ autoPlant 越线 `>0.95`（≥2）+ R6 同 `(industry,scale,seed)` 真 socket 重跑字节一致。

## 真跑结果

```
pnpm --filter datacore test a6-e2e-socket
✓ test/a6-e2e-socket.test.ts (2 tests) 486ms
  ✓ 真 socket 合成 → util 落业务区间 + autoPlant 越线（HTTP 栈全链真跑）
  ✓ R6：同 (industry,scale,seed) 真 socket 重跑字节一致
```

- POST `/a/v1/synthetic/jobs`(a6-reference·seed42) 经真 fetch → **HTTP 202**（非 inject）。
- GET `/a/v1/objects?type=Order` 经真 fetch → 12 条 Order，util 越线 ≥2、落区间 ≥8。
- R6：两次真 socket 合成 util 排序后逐位相等。

## 边界 / 诚实

- 与 `a6-value-domains.test.ts`（app.inject 验逻辑）**互补**：本单专补真 TCP 栈回归，两者并存。
- 未改任何 `src`（仅加测试文件）→ 既有全绿不动；`a6-reference` 模板逻辑早被 inject 测覆盖，本单补的是"真 socket 路径活着"。
- 现真 socket 路径**有自动回归**——核发附带的 ◐「真 socket 未固化」缺口闭合，建议审核方独立 `pnpm --filter datacore test a6-e2e-socket` 复验后核发。
