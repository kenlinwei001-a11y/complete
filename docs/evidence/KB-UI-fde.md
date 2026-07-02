# WO-KB-UI · FDE 亲手真跑证据（G-VIS-1 · 知识库 S4 前端落地）

> 目标（用户视角）：用户建一个 knowledge_base 连接并灌入文档后，能在前端【知识库页】看到这些文档并搜索命中——而非此前后端 kb.ts + 路由齐备、前端零页零绑定、灌进去的文档完全看不到。断点：G-VIS-1 IPO 断层（路2·生成物落地簇）。

## 根因判定

后端 `kb.ts`（KbService: addDoc/sync/search）+ 路由 `/kb/search`、`POST /kb/:connId/docs`（ingest）、`/kb/:connId/sync` 齐备，**但缺文档列表路由**，且前端 `endpoints.ts`/`adminRegistry` 零 kb 引用、无知识库页 → 灌进去看不到。治本：补后端 **GET /kb/:connId/docs 列表路由** + 前端知识库页消费（列文档 + 语义搜索·前端所见=后端真值）。

## C1 · 后端文档列表路由（真 curl · 内存态 datacore :4081）

建 knowledge_base 连接（`POST /a/v1/connections` connectorTypeKey=knowledge_base·config.endpoint 必填）→ ingest 2 篇（`POST /a/v1/kb/:connId/docs`）→ `GET /a/v1/kb/:connId/docs`：

```
count=2
first={"docId":"kbdoc_kdcaynaqpvw92b2w","filename":"OEE提升.txt","chunkCount":1,"connId":"conn_mpy3thpjs0y8rvq5","createdAt":...}
C1 assert (length==2 && has docId/filename/chunkCount): true
```

## C2 · 搜索真命中（真 curl）

`POST /a/v1/kb/search`（body `{connId, query:"换型损失"}`）→ `hits=2·top docId=kbdoc_x37...（涂布换型文档）·score=0.4583`。命中项 docId ∈ C1 文档集合（C2↔C1 勾稽）。

## C3/C4 · 前端知识库页（jsdom renderApp · 本仓 admin 页范式）

`apps/frontend-shell/test/kb-ui.test.tsx`（3 用例·全绿）：
- **C3 页存在+注册**：`App.tsx` lazy `admin("knowledge")`；`adminRegistry` 注册 `{path:"knowledge",label:"知识库",roles:["admin","data_admin"]}` 归入**数据接入组**（`ADMIN_NAV_GROUPS.data.paths` 含 knowledge → f61 nav-groups 断言无遗漏通过）→ 导航可达。页渲染知识库（kb 连接）列表。
- **C4 显同 M 文档+可搜**：`renderApp("/admin/knowledge")` → 左侧 `kb-conn-conn-kb` → 文档表 `kb-docs-table` 显 2 文档（涂布换型.txt / OEE提升.txt·标题一致·行数=thead+2）；搜索框输入「换型损失」→ `kb-search-results` 命中 `kb-hit-0` 含「换型」（前端所见=后端真值）。
- **空态诚实**：无 knowledge_base 连接 → `kb-empty` 引导（去建 kb 连接灌文档）·不伪造文档。

**牙齿自证**：把 `fetchKbDocs` 结果置空（文档表不渲染）→ C3/C4 转红；还原 → 3 绿。

## C5 · 前端 API 层（gate）

`rg kb apps/frontend-shell/src/api/endpoints.ts` 命中 `fetchKbDocs`/`searchKb`/`syncKb`；类型 `KbDocVM`/`KbHit`/`KbSearchResponse` import 自 `@platform/contracts`（未本地重定义·contracts-only-shared）。

## C6 · 回归四包全绿

- `pnpm -r build` exit 0；`pnpm gates` exit 0。
- datacore（新增 `kb.test.ts` GET /kb/:connId/docs 列表路由测·connId 隔离·C2↔C1 勾稽）；agentcore 无回退；frontend（+3 kb-ui 用例）；contracts build ✅。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md`：§2.H kb 增列表路由 + §8 G-VIS-1 追加 KB-UI 落地（第四单）。

## 距北极星还差什么（诚实边界）

- **C3/C4 以 jsdom 集成渲染证**（本仓 admin 页范式）+ **C1/C2 真 curl 后端真值**——非真浏览器截图（headless 未起全栈）；前端消费逻辑（页/文档表/搜索/空态）由 renderApp 门 + 牙齿自证覆盖，后端真值由 curl + datacore 集成测覆盖。
- 前端搜索 mock 用词面匹配（真后端是向量相似度）——mock 仅证前端消费形态，语义相关性由 datacore kb.test.ts 真向量检索验。
- G-VIS-1 尚余 P0（SOLVER-BINDING-UI / SANDBOX-RUN-HISTORY / SIM-PRESET-INJECT）+ P1/P2 在 loop 队列。
