# 复验 QOS-DIAG（1846669）→ ✅ DONE

审核方真跑复验（真起 datacore4001+agentcore4002·真 SSE 流·非信绿测试）：
- **根因坐实(C3)**：freeform /b/v1/queries 全 FAILED = classify 与 path-B agent 双需 LLM → LLM_PURPOSE_UNBOUND(demo 无 LLM)。违"确定性是地板"。dev 诊断准。
- **治本(C1)真跑**：真问句「常州基地影响哪些订单」经真 SSE：classify→**outcome:deterministic-fallback**(纯函数 bigram 例句匹配·无 LLM)→routing.completed **path:WORKFLOW intentKey:affected_orders conf:1**→invoke_solver **OK**→**answer.final**：6 单表(SO-3391/3445/3490/3420/3481/3476)+「受影响订单共 6 张」+provenance(invoke_solver·snapshot1.2·VERIFIED_WORKFLOW·unverifiedNumerics:false)。**不再 100% FAILED**。
- **前后端一致(C4)**：answer 6 单 == affected_orders solver 真值(provenance 指向 invoke_solver·TOOL_RESULT)·非硬塞。
- **全链在harness(佐证)**：evals-scenario-suite 20/20 passRate=1 intentAccuracy=1「真执行并产出答案」+ router-deterministic-classify 3 绿 + qos-a 8 绿。
- **C5 gates**：dev 34 门绿·我复跑 QOS 相关测全绿。
- **R6/诚实**：deterministic classify 纯函数(无 random/时钟)·model 标 deterministic:example-match 不冒充 LLM·全弱匹配→诚实降级 FAILED(不硬塞)·多中匹配→确定性 INTENT_CHOICE 澄清。LLM 可用时零行为变化。
- 诚实边界：我首轮误传 objectId(obj_base_changzhou)非 solver 要的 baseId(changzhou)→400 unknown base(=我测试输入错·非 dev 缺陷·且证 agentcore→datacore OBO 通)；正确 baseId 即 COMPLETED。
本体 §8 G-3 回写确定性分类兜底。解锁下游：场景/意图/产能问答单管线（无 LLM 亦可用）。
