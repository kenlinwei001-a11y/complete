# 复验 KB-UI（fb1a0b8）→ ✅ DONE

审核方真跑复验（curl 后端真值 + 真浏览器前后端一致 + 对抗查假），非信绿测试：
- **C1 curl**：建 knowledge_base 连接(conn_..)+ingest 2 篇(base64)→ GET /a/v1/kb/:connId/docs 返 length==2，每项 {docId,connId,filename,chunkCount,createdAt}。新增 GET 列表路由(app.ts:3951)真存在(此前仅 POST=ingest)。
- **C2 curl**：POST /a/v1/kb/search {q=ZEBRAQUARTZ} 返 2 命中·docId ∈ ingest 集合。
- **C3 browser**：/admin/knowledge 渲染·平台"知识库"导航可达·KB 连接列表含新建连接·可选中。
- **C4 browser 前后端一致**：文档表显 doc-alpha+doc-beta(==curl 后端 2 篇)；搜索框(kb-search-input)输 ZEBRAQUARTZ→**真调后端 /a/v1/kb/search**(网络抓包证·非前端假过滤)→前端渲染 2 命中(kb-hit-*)·前端 2==后端 2·显真 chunk 内容(相似度 14.7%/14.3%)。截图 kb-search.png。
- **C5 gate**：endpoints.ts 含 fetchKbDocs/searchKb/syncKb·KbDocVM/KbSearchResponse import 自 @platform/contracts(未重定义·contracts-only)。
- **C6 gate**：pnpm -r build 绿；kb.test.ts 3 绿(含 GET 列表+R2 connId 隔离)、kb-ui.test.tsx 2 绿(C3/C4+诚实空态)；frontend 130/agentcore 76/contracts/llm-adapters 全绿。
- **对抗查假全过**：前端显真 curl-ingest 文档(非 mock)·搜索真打后端(非死交互/假过滤)·前后端数值一致·空态诚实(kb-empty/kb-docs-empty/kb-search-empty 不伪造)。
