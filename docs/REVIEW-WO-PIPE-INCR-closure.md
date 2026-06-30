# 审核核发 · WO-PIPE-INCR ①（连接器真增量同步·CDC delta-merge）闭合

> 提交物 `c66e0ba`。源：审核方 D0 数据管线分析点出的「connectors `service.ts` 用 `rawRows.replace` 全量重灌·非增量/CDC」。本单把 rest_api 升为合法 CDC 源（`?since=` 下推）+ 按 pkField upsert 的 delta 合并 + watermark 推进；缺增量条件回落全量（旧连接器零影响）。审核方独立真跑 E2E + 对抗式撤回复验。

## 一句话结论

**✅ 闭合（① 范围内）。** delta-merge 真实现且真生效：二次 `?since=` 只灌 delta、按 pk upsert、未变行保留、watermark 推进——E2E 经真路由/真仓储读回落库行核对（A/C 留、B 覆盖、D 增、共 4 行）；对抗撤回合并 → 测试即红（2≠4）。缺增量条件回落全量重灌（向后兼容）。残留：upsert-only 无删除墓碑、read-merge-replace 全量载入先验行——均属 ① 合理边界，dev 以「①」明示后续增量。

## FDE 真跑核对

| 判据 | 状态 | 审核方独立证据 |
|---|---|---|
| 二次 `?since=` 只灌 delta（非全量重灌） | ✅ | E2E：首同步 3 行(A/B/C)·水位 2026-01-03；`sync?since=2026-01-03` 上游只回 B(改)+D(新) → `rowCounts.orders=2`（delta·非 4） |
| 按 pkField upsert·未变行保留 | ✅ | 真读 `GET /raw-datasets/:id/rows`：**A=甲 C=丙 留**、**B=乙-改 覆盖**、**D=丁 增**、rowCount=4（合并·非整表替换） |
| watermark 推进 | ✅ | `watermarks.orders` 2026-01-03 → **2026-01-06**（max(updatedAt)） |
| 门真咬（防回潮） | ✅（对抗） | neuter `service.ts:259` `finalRows=[...byPk.values()]`→`finalRows=delta`（丢先验行）→ 测试红「expected 2 to be 4」；还原 → 10/10 绿 |
| 缺增量条件回落全量 | ✅ | 读源：`incremental = connIncremental && existing && !!pkField && !!wmField`，否则 `finalRows=rows` 全量 `replace`（旧连接器零影响） |

## 读源坐实（机制）

- `registry.ts`：`rest_api.capabilities.incremental=true`；`RestApiAdapter.fetchBatch(name,cursor,since)` 把 `since` 下推为 `?since=`（CDC 源只回更新行）；`since===undefined` 全量（向后兼容）。
- `service.ts sync(ctx,connId,{since})`：① `connIncremental = incremental 能力 && since!==undefined`；② delta = 上游行按 `watermarkField > since` 筛（适配器已下推则幂等再筛·兜底不支持 since 的源）；③ 载入先验行入 `Map<pk,row>` → delta upsert 覆盖 → `finalRows=[...values]`；④ `watermark=max(wmField over finalRows)`；⑤ `rawRows.replace(finalRows)`（合并集·非仅 delta）；⑥ `rowCounts=incremental?deltaCount:total`。
- `domain.ts`：`RawDataset.watermark` + `DatasetConfig.{pkField,watermarkField}`。
- `app.ts`：`POST /connections/:id/sync?since=` 回执带各数据集 `watermarks`。

## 门 / 回归

- `pnpm -r build` 全绿（新字段 typecheck）；`connectors.test` **10/10**（含新 WO-PIPE-INCR E2E + 既有 7 连接器类型/凭据加密/4xx 降级回归）。
- 对抗撤回合并 → 红 → 还原 → 绿（测试真咬）。
- `ontology-writeback:check` 绿——**坐实 commit「补登 §7 漏登的 4 门」属实**（27 门全登记·§7 漏登 0）；§2 RawDataset 增量语义已回写。

## 诚实边界（dev 已以「①」明示·审核方确认）

1. **upsert-only·无删除墓碑**：上游删除的行在本地**保留**（delta 只增/改）。真 CDC 需 tombstone/软删标记——属后续增量（②）。
2. **read-merge-replace·非流式**：每次增量 sync 把**先验整集**载入内存合并再 replace（O(n) 内存/同步）。10⁴ 行规模无虞，超大数据集需真流式 upsert——属后续增量。
3. **仅 rest_api**：incremental 能力加在 rest_api；其余连接器（mock_erp 等）仍全量 replace（本单已 scope）。
4. **since 服务层兜底再筛**：适配器下推 `?since=` + 服务层按 watermarkField 再筛——对忽略 `?since=` 的源仍正确（防御式·好）。

## 本体引用与影响

- **§2 RawDataset**：+watermark / DatasetConfig +pkField+watermarkField（增量同步语义·已回写）。
- **数据→本体链**：连接器 sync 从「全量重灌」升为「CDC delta-merge」——数据管线成熟化 D0 地基的第一砖（紧张度/派生的上游真实性提升）。
- **§7 门禁**：ontology-writeback 抓出的 4 门漏登一并补齐（门禁维自洽收口）。
- **不变量 R6**（确定性）：delta 合并按 pk 幂等·同输入同结果，不破。

---
*审核方独立核发（design+review·真路由 E2E + 对抗撤回为据·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
