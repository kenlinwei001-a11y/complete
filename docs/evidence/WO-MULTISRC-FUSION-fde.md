<!-- WO-MULTISRC-FUSION-DOMAIN · N1 多源融合 + 冲突仲裁 + 测谎（建在 SolverBinding 之上）· FDE 交付证据 -->
<!-- 复现：pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build && pnpm --filter datacore build && node scripts/fde-multisrc-fusion.mjs -->

## 判据核对（WO §3）

- ✅ **同一 Order 多源交期各执一词 → 融合归并 + 两源仲裁**：ERP 交期 `2026-09-01` vs MES 交期 `2026-09-20`，
  经**权威源优先**仲裁采纳 MES（现场实测更权威·authority=3）→ 答案 `value=2026-09-20`，`chosenSource=MES`，
  `reason="权威源优先：采纳权威度最高源 MES"`（**标明取哪源/为何**）；`dataMode=PARTIAL`、字段置信 0.7
  （**置信反映跨源一致性**：有冲突 → 非 LIVE 冒充）；两源逐一溯源可见。
- ✅ **测谎真证（虚报产能）**：常州基地 SCADA 100 / MES 105 / 基地自报 **200**（虚报好看）→ 跨源相对极差
  `0.952381 > 阈值 0.15` → `suspect=true`、对象 `verdict=SUSPECT`、`dataMode=MOCK`（头条最审慎·不冒充真值），
  越界源 `SELF` 被揪出，**审慎取最保守值 100（不照单全收虚报的 200·R13）**，字段置信降级 0.35、越界源逐源置信砍半（0.333333）。
- ✅ **AUDIT 留痕可查**：`GET /a/v1/fused-objects?verdict=SUSPECT` 复盘融合态全貌（取哪源/为何/测谎证据/逐字段置信）；
  `GET /a/v1/audit-log?target=FusedObject` 见 append-only 审计 `fusion.suspect_detected`/`fusion.conflict_arbitrated`
  带 `actorId=planner01` + `requestId` + 采纳源/理由/置信。
- ✅ **R6 确定性**：场景1 重跑与首跑**字节一致 = true**（仲裁/测谎无随机/无时钟）。
- ✅ **R2 租户隔离**：融合仅读本租户对象（测试 `R2 租户隔离` 用例守：他租户对象不泄漏，融合 0 个）。

---

# WO-MULTISRC-FUSION-DOMAIN · FDE 真跑证据（真 HTTP over 127.0.0.1）

> 真起 datacore（buildApp·内存仓储）监听 http://127.0.0.1:39027·X-Debug-User: demo:planner01:admin


#### 场景1 · POST /a/v1/solvers/multisource_fusion/invoke（订单交期两源仲裁）
```json
{
  "data": {
    "role": "order",
    "fused": [
      {
        "pk": "SO-3391",
        "role": "order",
        "fields": [
          {
            "field": "due",
            "value": "2026-09-20",
            "chosenSource": "MES",
            "reason": "权威源优先：采纳权威度最高源 MES",
            "strategy": "AUTHORITY",
            "conflict": true,
            "suspect": false,
            "confidence": 0.7,
            "sources": [
              {
                "source": "ERP",
                "typeKey": "ErpOrder",
                "value": "2026-09-01",
                "confidence": 0.666667
              },
              {
                "source": "MES",
                "typeKey": "MesOrder",
                "value": "2026-09-20",
                "confidence": 1
              }
            ]
          }
        ],
        "verdict": "TRUSTED",
        "contributingSources": [
          "ERP",
          "MES"
        ],
        "confidence": 0.7
      }
    ],
    "suspectCount": 0,
    "conflictCount": 1,
    "dataMode": "PARTIAL",
    "strategies": [
      "AUTHORITY"
    ],
    "summary": "多源融合 1 个对象（role=order·2 源）：1 个存在跨源冲突经仲裁，0 个测谎命中标 SUSPECT（置信降级·不照单全收）。",
    "confidence": {
      "synthetic": false,
      "stale": false,
      "measurement": "PARTIAL"
    }
  },
  "snapshotVersion": "0.0"
}
```

#### 场景2 · POST .../invoke（常州产能：基地自报 200 vs 实测 100/105 → 测谎 SUSPECT）
```json
{
  "data": {
    "role": "base_capacity",
    "fused": [
      {
        "pk": "常州",
        "role": "base_capacity",
        "fields": [
          {
            "field": "capacity",
            "value": 100,
            "chosenSource": "SCADA",
            "reason": "测谎命中（源 SELF 疑虚报，跨源极差 0.952381 > 阈值 0.15）→ 审慎取最保守值（最小 100·不照单全收）",
            "strategy": "CONSERVATIVE",
            "conflict": true,
            "suspect": true,
            "suspectEvidence": {
              "spread": 0.952381,
              "threshold": 0.15,
              "outlierSource": "SELF",
              "outlierValue": 200,
              "median": 105
            },
            "confidence": 0.35,
            "sources": [
              {
                "source": "SCADA",
                "typeKey": "ScadaCap",
                "value": 100,
                "confidence": 1
              },
              {
                "source": "MES",
                "typeKey": "MesCap",
                "value": 105,
                "confidence": 0.833333
              },
              {
                "source": "SELF",
                "typeKey": "SelfReportCap",
                "value": 200,
                "confidence": 0.333333
              }
            ]
          }
        ],
        "verdict": "SUSPECT",
        "contributingSources": [
          "MES",
          "SCADA",
          "SELF"
        ],
        "confidence": 0.35
      }
    ],
    "suspectCount": 1,
    "conflictCount": 1,
    "dataMode": "MOCK",
    "strategies": [
      "CONSERVATIVE"
    ],
    "summary": "多源融合 1 个对象（role=base_capacity·3 源）：1 个存在跨源冲突经仲裁，1 个测谎命中标 SUSPECT（置信降级·不照单全收）。",
    "confidence": {
      "synthetic": false,
      "stale": false,
      "measurement": "MOCK"
    }
  },
  "snapshotVersion": "0.0"
}
```

#### AUDIT-1 · GET /a/v1/fused-objects?verdict=SUSPECT（融合态快照复盘：取哪源/为何/测谎证据）
```json
{
  "items": [
    {
      "id": "fused_t4hza7851t5cwk0s",
      "tenantId": "demo",
      "role": "base_capacity",
      "pk": "常州",
      "verdict": "SUSPECT",
      "fused": {
        "pk": "常州",
        "role": "base_capacity",
        "fields": [
          {
            "field": "capacity",
            "value": 100,
            "chosenSource": "SCADA",
            "reason": "测谎命中（源 SELF 疑虚报，跨源极差 0.952381 > 阈值 0.15）→ 审慎取最保守值（最小 100·不照单全收）",
            "strategy": "CONSERVATIVE",
            "conflict": true,
            "suspect": true,
            "suspectEvidence": {
              "spread": 0.952381,
              "threshold": 0.15,
              "outlierSource": "SELF",
              "outlierValue": 200,
              "median": 105
            },
            "confidence": 0.35,
            "sources": [
              {
                "source": "SCADA",
                "typeKey": "ScadaCap",
                "value": 100,
                "confidence": 1
              },
              {
                "source": "MES",
                "typeKey": "MesCap",
                "value": 105,
                "confidence": 0.833333
              },
              {
                "source": "SELF",
                "typeKey": "SelfReportCap",
                "value": 200,
                "confidence": 0.333333
              }
            ]
          }
        ],
        "verdict": "SUSPECT",
        "contributingSources": [
          "MES",
          "SCADA",
          "SELF"
        ],
        "confidence": 0.35
      },
      "requestId": "req_914793z739vrk098",
      "at": "2026-07-01T09:16:04.540Z"
    }
  ]
}
```

#### AUDIT-2 · GET /a/v1/audit-log?target=FusedObject（append-only 审计：actor/取哪源/为何/置信）
```json
{
  "items": [
    {
      "id": "aud_qgv4af5xbhbz2b3c",
      "tenantId": "demo",
      "actorId": "planner01",
      "action": "fusion.suspect_detected",
      "targetKind": "FusedObject",
      "targetId": "base_capacity:常州",
      "after": {
        "verdict": "SUSPECT",
        "confidence": 0.35,
        "suspectFields": [
          {
            "field": "capacity",
            "spread": 0.952381,
            "threshold": 0.15,
            "outlierSource": "SELF",
            "outlierValue": 200,
            "median": 105
          }
        ],
        "arbitration": [
          {
            "field": "capacity",
            "chosenSource": "SCADA",
            "strategy": "CONSERVATIVE",
            "reason": "测谎命中（源 SELF 疑虚报，跨源极差 0.952381 > 阈值 0.15）→ 审慎取最保守值（最小 100·不照单全收）",
            "confidence": 0.35
          }
        ],
        "sources": [
          "MES",
          "SCADA",
          "SELF"
        ]
      },
      "at": "2026-07-01T09:16:04.560Z",
      "requestId": "req_914793z739vrk098"
    },
    {
      "id": "aud_9396v9mnt64s5pbs",
      "tenantId": "demo",
      "actorId": "planner01",
      "action": "fusion.conflict_arbitrated",
      "targetKind": "FusedObject",
      "targetId": "order:SO-3391",
      "after": {
        "verdict": "TRUSTED",
        "confidence": 0.7,
        "suspectFields": [],
        "arbitration": [
          {
            "field": "due",
            "chosenSource": "MES",
            "strategy": "AUTHORITY",
            "reason": "权威源优先：采纳权威度最高源 MES",
            "confidence": 0.7
          }
        ],
        "sources": [
          "ERP",
          "MES"
        ]
      },
      "at": "2026-07-01T09:16:04.321Z",
      "requestId": "req_kdp1wmsj7be43zps"
    }
  ],
  "total": 2
}
```

#### R6 确定性：场景1 重跑与首跑字节一致 = true
