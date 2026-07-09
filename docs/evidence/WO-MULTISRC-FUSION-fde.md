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

---

## 收尾 FDE（2026-07-09）· 活体真 demo 多源数据 + S25 NL 接地

**为什么收尾**：初版求解器 + 单测已绿，但 (a) 运行态 demo 租户无任一对象存在两源同 pk → S25 活体 NL 一跑必空；(b) S25 场景卡 `sources` 曾指不相关类型（`Order`+`Model`·pk 永不重叠）。

**诚实数据边界**：本次播的 `ErpOrder/MesOrder/SrmOrder` 是 **DEMO 合成夹具（origin=SYNTHETIC·jobId=`seed-multisrc-fusion-demo`）**，用真实 demo 订单号（SO-3391 等）演示"同一订单事实被 ERP/MES/SRM 各执一词"的融合机制——**非从真实源系统抽来的真源数据**。真实租户由真连接器同步 + SolverBinding 归一喂入（机制同·数据真）。

### 真起服务（内存态·SEED_DEMO=1）
- datacore：`PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-msf SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js`
  - 启动日志：`SEED_DEMO=1: seeded demo multi-source fusion fixture (ErpOrder/MesOrder/SrmOrder, SYNTHETIC, conflict+SUSPECT)`
- agentcore：`PORT=4102 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js`

### 真 HTTP：`POST /a/v1/solvers/multisource_fusion/invoke`（S25 口径·X-Debug-User: demo:admin:admin）
入参 = S25 场景卡 slotPresets（role=order·fields=[due,cap]·ERP/MES/SRM authority 1/3/2·defaultStrategy=AUTHORITY·suspectThreshold=0.15）。真实返回（`.data` 摘要）：

```json
{
  "role": "order",
  "dataMode": "MOCK",
  "conflictCount": 4,
  "suspectCount": 2,
  "strategies": ["AUTHORITY", "CONSERVATIVE"],
  "summary": "多源融合 5 个对象（role=order·3 源）：4 个存在跨源冲突经仲裁，2 个测谎命中标 SUSPECT（置信降级·不照单全收）。",
  "fusedPks": ["SO-3391", "SO-3402", "SO-3415", "SO-3431", "SO-3445"],
  "SO_3391": {
    "verdict": "SUSPECT", "confidence": 0.35, "contributingSources": ["ERP", "MES", "SRM"],
    "due": { "conflict": true, "chosenSource": "MES", "value": "2026-07-08", "strategy": "AUTHORITY" },
    "cap": {
      "conflict": true, "suspect": true, "strategy": "CONSERVATIVE",
      "chosenValue": 8, "chosenSource": "ERP", "confidence": 0.35,
      "suspectEvidence": { "spread": 1.333333, "threshold": 0.15, "outlierSource": "MES", "outlierValue": 20, "median": 9 }
    }
  }
}
```

**读法**：SO-3391 交期各执一词（ERP 06-24 vs MES 07-08）→ 权威源仲裁采纳 MES 实际交期；产能三源 ERP=8/SRM=9/MES=20 → 测谎揪出 **MES 虚报**（离群·极差 1.333>0.15）→ 审慎取最保守 cap=8（**不照单全收 20**·CONSERVATIVE）+ 置信降级 0.35 + verdict=SUSPECT。整批 `dataMode=MOCK`（有测谎命中→头条最审慎不冒充真值）。

### dataMode 诚实边界（活体实测·重要）
- **S25 口径 [due,cap]** → `dataMode=MOCK`（suspectCount>0 → 头条最审慎）。
- **仅冲突无测谎**（fields=[due] 两源）→ 求解器核判 PARTIAL，但因底层对象 origin=SYNTHETIC，invoke wrapper 的置信叠加把头条抬为 **`dataMode=SYNTHETIC`**——**诚实标注"这是合成夹具数据"**（真实租户真源数据则为 LIVE/PARTIAL）。
- **R2 隔离**：`X-Debug-User: other:u:admin` 同参数 → `fused` 数 0（demo 夹具不越租户）。

### S25 场景卡活体下发（`GET /b/v1/scenarios`·agentcore）
`sNo=S25 · solver=multisource_fusion · slotPresets.sources=[ErpOrder, MesOrder, SrmOrder]`（已接种子真类型·非旧 Order/Model 幽灵）。

### 门（teeth）
`apps/datacore/test/multisource-fusion.test.ts` 新增「DEMO SEED 多源夹具」组：断言 `seedDemoMultiSourceFusion` 播的真 demo 数据经 S25 口径融合出 conflictCount=4 / suspectCount=2 / SO-3391 verdict=SUSPECT / cap 审慎取 8 / outlierSource=MES / AUDIT `fusion.suspect_detected` 留痕 + `fused_objects` 快照 + R6 字节一致。**撤种子/改一致即红**。
