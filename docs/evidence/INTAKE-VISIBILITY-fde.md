# WO-INTAKE-VISIBILITY · FDE 亲手真跑证据（G-VIS-1 · 上传→建模→物化一条龙可见+引导）

> 目标（用户视角·对应用户两问「看不到导入数据」）：上传含新字段的文件后当页就看到导入的行（不被弹到 /schema）；
> objectify 未精确命中的列写进「待确认」队列，在新的 SchemaReconcile 页逐列确认（USE/RENAME/NEW/MERGE/DISCARD）→resolve→重跑物化→对象浏览器见实例；
> 对象浏览器/切片库空态给「N 张已导入未建模→去建模」深链。断点：G-VIS-1 IPO 断层（路1·上传后弹走/skip 列无处确认/空态死路）。

## 根因判定

后端 objectify（`materializeFromReconcile`）计算出 `recon.candidates`（列名未精确命中的列）但**静默丢弃**——仅 autoMapped 精确命中列入物化，skip 列既不物化也不入队列，前端零 API 零页面 → 「上传后看不到 / 无处确认 / 空态死路」。治本：skip 列落 reconcile 队列（带 connId+样本值），人确认后**喂回物化**（确认真生效）。

## C1 · 上传就地可见（前端·`DataCategoriesPanel.tsx`）

改：`uploadData.onSuccess` 由 `navigate('/admin/connections/:id/schema')`（无条件弹走）→ `setUploadedConnId(res.connId)` + invalidate raw-datasets + 就地渲染 `UploadedPreview`（拉该连接 raw-datasets/rows·表格显导入行·表头=上传列头·附「去字段核对/建模 →」软链非强制跳）。用户当页看到导入的数据。testid：`dc-upload-preview` / `dc-upload-preview-table` / `dc-upload-goto-schema`。

## C2 · skip 列入待确认队列（真 curl · 内存态 datacore·fresh 租户）

`POST /a/v1/uploads`（newfields.csv：`baseId,name,util,newcol_carbon,newcol_shift`）→ `POST /a/v1/databuilder/intake/objectify` → 返 `candidates=5`；`GET /a/v1/databuilder/reconcile-candidates?connId=<id>`：

```
count=5  first={"column":"baseId","suggestedAction":"NEW","sampleValues":["cz1","hf1"],"connId":"conn_..."}
```

断言 ✅：`length>0`；每项含 `{column, suggestedAction, sampleValues, connId}`；connId 过滤真生效（换不存在 connId → 空）。改动前该路径未持久化候选（返空）。

## C3 · SchemaReconcile 页（前端·新 `pages/admin/SchemaReconcilePage.tsx`）

`api/endpoints.ts` 补 `fetchReconcileCandidates` / `resolveReconcileCandidate`（类型 `SchemaReconcileCandidate` 自 `@platform/contracts`·未重定义）；`App.tsx` lazy 路由 `admin("schema-reconcile")`；`adminRegistry` 注册（roles admin/data_admin·**建模与图谱组**·`ADMIN_NAV_GROUPS.modeling.paths` 含 schema-reconcile·导航可达）。页读 `?connId=`，列出候选列 + 每列样本值 + USE/RENAME/NEW/MERGE/DISCARD 下拉 + 目标字段输入（datalist 给候选 type.field 分）+ 确认按钮 + 「重跑物化(objectify)」按钮 + 诚实空态。jsdom 测 `test/intake-visibility.test.tsx`（页渲染/候选落表/动作+目标控件/resolve 提交/空态·全绿）。

## C6 · IPO 端到端闭环（datacore 集成测试 · `test/intake-visibility.test.ts` · 权威）

`seedBattery`（Order 含 so/qty）→ 上传 `so,ordered_qty`（so 精确命中 Order.so·ordered_qty 部分命中→候选）→ objectify#1（ordered_qty 入队列·带样本值 1777）→ `resolve(USE→qty)` → objectify#2（**重跑物化·resolve 生效**）→ `GET /a/v1/objects?type=Order` 找 SO-E2E-9 实例 → **`props.qty === 1777`（上传行 ordered_qty 值）**。前端所见=后端真值·确认真生效非装饰。

curl 版脚本 `scratchpad/intake-e2e.mjs` 亦真跑通后端闭环（objectify#2 materialized Order count=2·resolve→qty 生效）；对象**可见性**在集成测试的干净发布本体租户中直证（demo 已灌合成快照会遮蔽新物化对象·见边界）。

**牙齿自证**：删掉 `materializeFromReconcile` 里 resolved 列喂回物化的分支 → C6 转红（qty=NaN）；还原 → 2 绿。证 resolve→物化真接线而非摆设。

## C4 · 空态深链回接（前端·`ObjectTypesBrowserPage` + `SlicesPage`）

0 类型空态：若 `fetchRawDatasets()` 返 N>0，显「你已导入 N 张数据表尚未建模——去建模（预填这些表）→」`Link` 带 `?datasets=<ids>`（testid `ot-empty-tomodeling` / `slice-empty-tomodeling`）；非死空态。

## C5 · 字段核对多表可选（前端·`FieldProfilePage`）

`DataSourceRowsEditor` 不再硬取 `dsQ.data?.[0]?.id`——`datasets.length>1` 时出数据表选择器（testid `ds-table-select`），可切换编辑第 2+ 张表的字段画像。

## C7 · 回归四包全绿

- `pnpm -r build` exit 0；`pnpm gates` exit 0。
- datacore（含新 `test/intake-visibility.test.ts` 2 用例·prototype-intake/modeling 无回退）；agentcore 360 passed；frontend **336 passed**（334→336·+2 SchemaReconcile 用例·其余不回退）；contracts build ✅。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md §8 G-VIS-1` 追加 INTAKE-VISIBILITY 落地（第三单）。

## 距北极星还差什么（诚实边界）

- **C1/C3/C4/C5 以 jsdom 集成渲染 + curl 证**（本仓 admin 页范式），**非真浏览器截图**（headless 未起全栈拍图）；C6 对象可见性用 datacore 集成测试直证（demo 合成快照会遮蔽新物化对象的 query 可见性——属快照刷新语义·非本 WO 范围·集成测试在干净发布租户中直证闭环）。
- resolve 目标类型定夺优先归入该表 autoMapped 主类型（避免误落同名字段旁类型）；NEW（新建字段/类型）在 fresh-零类型租户需类型创建流·当前落 reconcile 记录意图（诚实边界）。
- G-VIS-1 尚余 2 P0（KB-UI / SOLVER-BINDING-UI）+ P1/P2 在 loop 队列。

---

## 追加轮（审核方历史审计·2.2）：C3/C5 真浏览器补齐（原 jsdom → 🟢）

用户令「历史未复验都逐一检查」发现本单 C3/C4/C5 原仅 jsdom（上文诚实边界自曝）。审核方真浏览器（chromium + 真 vite:5200 直连真 datacore:4001）补齐：
- 前置真 curl：上传 newfields.csv → objectify → **4 候选**（baseId/name→USE·newcol_carbon/newcol_shift→NEW）+ 物化 2 Base。
- **C3**：`/admin/schema-reconcile?connId=` 真浏览器渲染 4 候选 + **USE/RENAME/NEW/MERGE/DISCARD 全 5 选项**（真读 select.options）+ 样本值(cz1/常州基地/12.5) + 确认 + 重跑物化按钮。截图 `.intake-c3.png`。
- **C5**：`/admin/connections/<合成conn·35datasets>/schema` → `ds-table-select` present·**35 option**（datasets>1 真触发多表选择器）。截图 `.intake-c5.png`。
- **C4**：demo 非空（49 类型）→ 空态深链不触发（状态边界·真 0 类型需 fresh 租户·jsdom 测已覆盖渲染）。
判决：C3/C5 真浏览器闭合·C4 边界文档化 → INTAKE-VISIBILITY 达 🟢 金标准。详见 `docs/REVIEW-HISTORICAL-AUDIT-unverified.md §2.2`。
