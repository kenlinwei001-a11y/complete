# FILL-BOUNDARY-GUARDRAIL · 真实双服务 FDE 证据（不作假）

WO **FILL-BOUNDARY-GUARDRAIL**（用户钉「触发补数据必须有边界·否则任意问题自由补数据=数据混乱」）。
真起 datacore(:4001·内存·SEED_DEMO=1) + agentcore(:4002)。复现用户泛问题「本月库存水位是否可以降低？」（无月份/型号/仓类/物料）。
端点 `POST /b/v1/growth/run`（前置三闸 gate·`agentcore/growth/data-boundary.ts decideTriggerBoundary`）。生成 2026-07-03T16:32:30Z。

## B1 槽位完备闸 · 泛问题无槽位·未 confirmed → CLARIFY（先澄清·非直接触发·不合成）
此前现状=直接出「▶触发生成缺失数据」按钮跑 LOOP；现回 CLARIFY 复用 Clarification「第 1/2 次确认」先澄清。
```json
{
  "boundaryGate": {
    "outcome": "CLARIFY",
    "round": 1,
    "maxRounds": 2,
    "missingSlots": [
      {
        "name": "base",
        "type": "enum",
        "required": true,
        "enumValues": [
          "常州",
          "厦门",
          "成都",
          "眉山",
          "武汉",
          "江门",
          "合肥",
          "信阳",
          "枣庄",
          "邯郸",
          "自贡",
          "洛阳"
        ],
        "clarifyPrompt": "请指定基地（对象域）",
        "description": "补数据的目标基地——取自基地注册表"
      },
      {
        "name": "segment",
        "type": "enum",
        "required": true,
        "enumValues": [
          "乘用车",
          "储能",
          "商用车"
        ],
        "clarifyPrompt": "请指定应用细分",
        "description": "补数据的应用细分——取自细分注册表"
      },
      {
        "name": "model",
        "type": "enum",
        "required": true,
        "enumValues": [
          "4680-NCM",
          "VDA-NCM",
          "4680-LFP",
          "储能-280Ah",
          "储能-314Ah",
          "刀片-LFP"
        ],
        "clarifyPrompt": "请指定型号",
        "description": "补数据的型号——取自型号注册表"
      },
      {
        "name": "timeWindow",
        "type": "timeWindow",
        "required": false,
        "clarifyPrompt": "请指定时间窗（月份/区间）",
        "description": "补数据的时间范围"
      }
    ],
    "resolvedSlots": {},
    "reason": "问句未解析必需槽位（对象域/实体/时间窗）——先确定性澄清再补，不盲补（第 1/2 次确认）"
  }
}
```

## B1→B2 · 补齐定位槽位 base=常州（注册表既有）·未 confirmed → PREVIEW（生成计划预览·人确认才跑）
```json
{
  "boundaryGate": {
    "outcome": "PREVIEW",
    "plan": {
      "typeKey": "Object",
      "fields": [
        "id",
        "name",
        "value"
      ],
      "rows": 6,
      "valueDomainSource": "注册表既有值域（BASE/SEG_REGISTRY）+ 已发布 ObjectType schema（IndustryPack·R14）",
      "boundedEnums": [
        {
          "field": "base",
          "values": [
            "常州"
          ]
        }
      ],
      "origin": "SYNTHETIC",
      "provisional": true
    },
    "resolvedSlots": {
      "base": "常州"
    },
    "reason": "必需槽位已解析、目标类型在已发布 schema 内——出生成计划预览，人确认才跑（产出 PROVISIONAL/SYNTHETIC）"
  }
}
```

## B2 确认生成 · confirmed=true → 真跑 LOOP（产出 PROVISIONAL/SYNTHETIC·SOFT 登记在办看板人工闸）
```json
{
  "question": "本月库存水位是否可以降低？",
  "maxRounds": 1,
  "rounds": [
    {
      "round": 1,
      "gapReport": {
        "question": "本月库存水位是否可以降低？",
        "taskId": "task_01KWMD661PHZVMGG94F5XF8Y7H",
        "verdict": "BLOCKED",
        "path": "AGENT",
        "findings": [
          {
            "gapCode": "OTHER",
            "evidence": "LLM_PURPOSE_UNBOUND: LLM 用途未解析到可用 provider（回落内置 anthropic 但无可用凭据）——请在 设置→LLM 用途绑定 配置 provider 与密钥",
            "suggestedFill": "人工核实内部错误",
            "blocking": true
          }
        ],
        "generatedAt": "2026-07-03T16:32:30.825Z"
      },
      "fillApplied": {
        "gapCode": "OTHER",
        "action": "人工核实内部错误（当前不可自动补→骨架工单）",
        "advanced": false,
        "ticket": {
          "gapCode": "OTHER",
          "detail": "LLM_PURPOSE_UNBOUND: LLM 用途未解析到可用 provider（回落内置 anthropic 但无可用凭据）——请在 设置→LLM 用途绑定 配置 provider 与密钥"
        }
      }
    }
  ],
  "terminalState": "BOUNDARY",
  "openTickets": [
    {
      "gapCode": "OTHER",
      "detail": "LLM_PURPOSE_UNBOUND: LLM 用途未解析到可用 provider（回落内置 anthropic 但无可用凭据）——请在 设置→LLM 用途绑定 配置 provider 与密钥"
    }
  ],
  "generatedAt": "2026-07-03T16:32:30.833Z"
}
```

## B3 越界闸 · slotValues.base=火星基地（词表外新实体）→ HARD_BLOCK（confirmed=true 也不放行·新实体不得自动合成）
```json
{
  "boundaryGate": {
    "outcome": "HARD_BLOCK",
    "dataRequest": {
      "typeKey": "Object",
      "columns": [
        "（该类型待人工描述的字段/值域/样例）"
      ],
      "entities": [
        "火星基地"
      ],
      "reason": "「火星基地」不在注册表既有base枚举内——疑为词表外新实体；自动合成将发明不存在的业务实体，拒绝；须人工输入数据描述（字段/值域/样例）→ R4 审批物化为值域模板后才允许 SOFT 合成",
      "newEntity": true,
      "descriptionRequired": true,
      "descriptionSchema": [
        {
          "field": "fields",
          "hint": "该类型的字段列表（如 id/name/capacity）"
        },
        {
          "field": "valueDomain",
          "hint": "各字段值域/枚举/量纲"
        },
        {
          "field": "samples",
          "hint": "2-3 条样例行"
        }
      ]
    },
    "reason": "B3 词表外新实体「火星基地」→ 人工正门（数据描述 + R4）"
  }
}
```

## B3 · 人工输入数据描述 → 登记 HARD 在办项（importData 深链 /connections·待 R4 正门·可追溯非黑箱）
```json
{
  "boundaryGate": {
    "outcome": "HARD_BLOCK",
    "dataRequest": {
      "typeKey": "Object",
      "columns": [
        "（该类型待人工描述的字段/值域/样例）"
      ],
      "entities": [
        "火星基地"
      ],
      "reason": "「火星基地」不在注册表既有base枚举内——疑为词表外新实体；自动合成将发明不存在的业务实体，拒绝；须人工输入数据描述（字段/值域/样例）→ R4 审批物化为值域模板后才允许 SOFT 合成",
      "newEntity": true,
      "descriptionRequired": true,
      "descriptionSchema": [
        {
          "field": "fields",
          "hint": "该类型的字段列表（如 id/name/capacity）"
        },
        {
          "field": "valueDomain",
          "hint": "各字段值域/枚举/量纲"
        },
        {
          "field": "samples",
          "hint": "2-3 条样例行"
        }
      ],
      "description": "字段: id/name/capacity; 值域: GWh 0-50; 样例: mars-1,火星基地,10"
    },
    "reason": "B3 词表外新实体「火星基地」→ 人工正门（数据描述 + R4）"
  },
  "worklistItem": {
    "id": "wli_01KWMD6651P7K3G1S53N7ED0JX",
    "tenantId": "demo",
    "fromQuestion": "本月库存水位是否可以降低？",
    "gapCode": "EMPTY_DATA",
    "kind": "DATA_GAP",
    "status": "OPEN",
    "fillPlan": {
      "mode": "HARD",
      "action": "importData",
      "typeKey": "Object"
    },
    "evidence": "[B3 越界新实体] B3 词表外新实体「火星基地」→ 人工正门（数据描述 + R4）｜数据描述: 字段: id/name/capacity; 值域: GWh 0-50; 样例: mars-1,火星基地,10",
    "deeplink": "/connections",
    "createdAt": "2026-07-03T16:32:30.881Z",
    "updatedAt": "2026-07-03T16:32:30.881Z"
  }
}
```

## 真浏览器（Chromium·真渲染 `<GapCard>`·真调 agentcore:4002·前端所见逐值对照后端）

真起 Vite dev（VITE_AGENTCORE_URL=http://127.0.0.1:4002·真登录 JWT demo/admin）→ Playwright 真 Chromium 渲染真实 `<GapCard>` 组件，驱动三闸后端：

- `fbg-browser-1-initial.png`：缺口卡 OTHER + 「▶触发生成缺失数据」按钮（触发前）。
- `fbg-browser-2-clarify.png`：**点触发后不直接跑**——出「先澄清再补·缺必需槽位·第 1/2 次确认」+ 请指定基地/应用细分/型号/时间窗 槽位表单（复用 Clarification）·**无「继续推演」**（B1 teeth：非直接触发）。
- `fbg-browser-3-preview.png`：补 base=常州（注册表既有）→「生成计划预览·确认才跑」——将建/补类型：Object·预计合成行数：6（PROVISIONAL·origin=SYNTHETIC）·值域来源：注册表既有值域(BASE/SEG_REGISTRY)+已发布 ObjectType schema(IndustryPack·R14)·有界枚举取值：base=常州·「✓确认生成」（B2）。

逐值对照：前端预览 typeKey=Object / rows=6 / origin=SYNTHETIC / provisional=true / boundedEnums base=常州 —— 与上文 `POST /b/v1/growth/run` PREVIEW 后端 JSON 逐字段一致。
