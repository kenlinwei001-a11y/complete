# OntoFlow (Data Builder Studio) 三段真跑复验（滚动·待O2前端合并）

分支 origin/claude/parallel-agent-tasks-d3xmzn (HEAD bf4ca35·与主线零共祖)。三段=P4后端(readiness/scaffold/generic-inference)+P5前端画布+P6双模式联调。

## Agent O1（P4 后端·已回·worktree 4031/4131·真HTTP黑盒非MSW）

**总:核心推演真算·2 PASS(readiness/generic-inference) + 2 BLOCK(feature门控缺失/scaffold不落库)·非造假·均功能缺口。**

1. **feature 门控 — BLOCK**：`feature.data-builder` 不存在(features.ts:12-69 无此键)·/a/v1/ontology-workflows/* 路由(app.ts:1338-1365)零门控(无requireFeature)·全局onRequest(562-587)仅鉴权非门控。真跑:无feature GET → HTTP200{items:[]}·PUT features{data-builder:false}→VALIDATION_ERROR unknown feature key。**端点恒可达无法关·违 PRD§4/§9.3"关→404 FEATURE_NOT_FOUND"·违 Entitlement先于authz铁律**。
2. **readiness — PASS(真算非写死)**：computeReadiness(readiness.ts:148-156)7维加权纯函数。真跑:Order100/Supplier19(手算34×0.2+60×0.2=18.8→19吻合)/overall60。剥Order数据→Order100→22·overall→21(随数据真变)·byte-identical。
3. **scaffold — BLOCK(真算蓝图但不落库·非"生成应用")**：service.scaffold→buildScaffold(scaffold.ts:55-102·service.ts:162-165)只返回计算结构·零repo写入。真跑:返回真实体派生蓝图(views[ledger_BOrder..]/scenes/agents[5tools]/solverBindings[generic_whatif])·PUBLISHED门控。**但scaffold后 /b/v1/agents仍2·/b/v1/scene-entries仍9·无一落库可查**。=真算blueprint(非mock非空壳200)但不apply·PRD§8.1"生成应用(复用seedViewConfigs泛化)"未兑现·用户拿JSON计划应用里查不到产物。
4. **generic-inference(核心命门) — PASS(真后端真算)**：computeInference(generic-inference.ts:168-227)读真物化对象(service.ts:171-178 repos.objects.listByType)有界传播。真跑(对象经Action真物化):Δqty+5@O1→qty10→15/revenue20→30(derived)/S1.total_qty14→19(link:SUPPLIES SUM)/S1.load2 28→38(2nd-hop)·四跳全对;改Δ真变(Δ+100→220等比)·换目标O3→只影响S2不碰S1·确定性byte-identical·推演不改库存(工作副本)。**真重算非假重算**。
5. **R6+多租户 — PASS**：三端byte-identical·跨租户全404。
6. **门**：datacore 279/279绿(P4:workflow8/generic-inference5/readiness5/scaffold6/processing5)·agentcore192/192·contracts7/7。frontend并行3失败(f16/f18/f23既有视图·隔离重跑108/108绿·flaky资源竞争非P4回归)。

**待O2前端+P6联调回**：画布真编辑真落后端? 准备度/scaffold/推演前端逐值对照? 双模式端到端(图谱先行/数据先行)真跑通(发布后真产本体/视图)? → 合并三段裁决。

## 预判 BLOCK 汇总(待O2补前端)
- B1 feature.data-builder 门控缺失(端点恒可达·违Entitlement铁律+PRD§4/§9.3)。
- B2 scaffold 不落库("生成应用"未兑现·只返JSON蓝图·应用查不到产物·PRD§8.1)。
- (scaffold与feature是功能缺口·非造假;readiness/generic-inference核心真算已证)
