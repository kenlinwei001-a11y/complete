# 轨A 沙盘 P1 三项 · FDE 真启动证据（API 层 · 非 mock）

> 方法：datacore 内存态 `SEED_DEMO=1`（启动日志确认 'seeded demo sim propagation rules (sandbox non-empty)'），
> 经 X-Debug-User 真请求沙盘端点，证三项 P1 的**数据来源全是真派生**（R14 零写死 / R13 真溯源 / R6 确定性）。
> 日期 2026-06-26。范围诚实声明：本批证据为 **API 层端到端真数据**（雷达/溯源/AI 指挥台消费的就是这些端点）；
> 浏览器 Playwright 实拍未在本环境跑（SPA 内存 token 不可 reload，需额外脚手架），故定性为**半真**——前端组件经 277 前端测试 + tsc + build 全绿，数据真但未亲手点。

## ① 健康6维+信任4维 双雷达 —— 数据源（GET /sim/sessions/:id/certification）
```json
{
  "level": "L1_CONFIGURED",
  "dims": {
    "structure": 100,
    "knowledge": 28,
    "behavior": 18,
    "composite": 54
  },
  "l4Checks": {
    "fanoutSafe": true,
    "writebackComplete": true,
    "observabilityMet": true
  },
  "trialTick": {
    "passed": true,
    "rulesFired": 0,
    "at": "2026-06-26T15:44:03.598Z",
    "error": null
  },
  "worldCompleteness": {
    "pct": 35,
    "stateVars": {
      "present": 0,
      "needed": 11
    },
    "derivationRules": {
      "present": 0,
      "needed": 11
    },
    "actions": {
      "present": 9,
      "needed": 9
    },
    "propagationRules": {
      "present": 3,
      "needed": 3
    },
    "entering": [
      {
        "key": "adopt_mitigation",
        "kind": "ACTION",
        "source": "ACTION adopt_mitigation"
      },
      {
        "key": "plan_change",
        "kind": "ACTION",
        "source": "ACTION plan_change"
      },
      {
        "key": "AOP情景拍板",
        "kind": "ACTION",
        "source": "ACTION AOP情景拍板"
      },
      {
        "key": "校准参数变更",
        "kind": "ACTION",
        "source": "ACTION 校准参数变更"
      },
      {
        "key": "采纳经营方案",
        "kind": "ACTION",
        "source": "ACTION 采纳经营方案"
      },
      {
        "key": "定稿月度计划版本",
        "kind": "ACTION",
        "source": "ACTION 定稿月度计划版本"
      },
      {
        "key": "计划版本变更",
        "kind": "ACTION",
        "source": "ACTION 计划版本变更"
      },
      {
        "key": "采纳产能保障方案",
        "kind": "ACTION",
        "source": "ACTION 采纳产能保障方案"
      },
      {
        "key": "对象数据变更",
        "kind": "ACTION",
        "source": "ACTION 对象数据变更"
      },
      {
        "key": "demo_line_util_to_base_load",
        "kind": "PROPAGATION",
        "source": "PROPAGATION demo_line_util_to_base_load"
      },
      {
        "key": "demo_model_demand_to_base_load",
        "kind": "PROPAGATION",
        "source": "PROPAGATION demo_model_demand_to_base_load"
      },
      {
        "key": "demo_order_demand_pressure",
        "kind": "PROPAGATION",
        "source": "PROPAGATION demo_order_demand_pressure"
      }
    ]
  }
}
```
派生映射（SandboxView.deriveHealthDims/deriveTrustDims）：健康[规则覆盖=propagationRules比/利用率=dims.knowledge/闭包=derivationRules比/周期安全=l4.fanoutSafe/可观测=l4.observabilityMet/激活=actions比]；信任[运行时=trialTick.passed/可解释=l4.writebackComplete/时序=trialTick/数据可信=worldCompleteness.pct]。needed=0 的维 → hasData=false 诚实标 *，不画顶点。

## ② AI 指挥台 —— 确定性意图解析（R6 纯函数，无 LLM）
parseSandboxIntent 单测证：'推进 5 个 tick'→tick(n=5) · '存档检查点'→checkpoint · '分支对比'→branch · '查询就绪状态'→query · '帮我画条龙'→unknown（诚实降级）。同输入字节一致。NL「推进 2 tick」经 simTick 真调 2 次（已有沙盘 API，不新建并行）。

## ③ R13 溯源悬浮 —— GET /a/v1/lineage/object/:type/:id（真对象真链路）
```json
{
  "object": {
    "id": "obj_order_SO-3391",
    "type": "Order",
    "origin": {
      "type": "MATERIALIZED",
      "datasetId": "rds_t2brrt9kxagabynj",
      "jobId": "job_38dke2phdtyan478"
    }
  },
  "source": null,
  "derivations": [
    {
      "prop": "value",
      "formula": "qty * unitPrice"
    }
  ],
  "snapshotVersion": "1.2"
}
```
LineageChain 沿本体链路渲染：数据源→原始表→建模派生(derivations)→对象(snapshotVersion)。source=null 时诚实标'无连接来源'，不裸渲染。空世界（无 nodeObjectIds）→ '该类型无已物化对象'。

## 启动日志佐证
```
{"level":30,"time":1782488577903,"pid":13439,"hostname":"vm","msg":"SEED_DEMO=1: seeded demo sim propagation rules (sandbox non-empty)"}
{"level":30,"time":1782488577929,"pid":13439,"hostname":"vm","component":"http","msg":"Server listening at http://127.0.0.1:4001"}
{"level":30,"time":1782488577929,"pid":13439,"hostname":"vm","component":"http","msg":"Server listening at http://192.0.2.2:4001"}
{"level":30,"time":1782488577929,"pid":13439,"hostname":"vm","port":4001,"msg":"datacore listening"}
```
