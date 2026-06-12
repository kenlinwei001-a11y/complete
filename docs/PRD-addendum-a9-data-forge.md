# PRD 增量 · A9 仿真数据工坊（Data Forge：提示词/配置器 → 接近真实的模拟数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0（DataCore 新增模块 A9；扩展 A7 行业模板与 A8 tsGenerators，运营态增量的生成规约统一收编为本模块的 GenSpec） |
| 目标 | 通过**提示词**或**配置器**两种方式产出"接近真实"的模拟数据，用于：① 工程验证（管线/算法/性能在真实级数据下被检验）② 售前/POC 数据定制 ③ 算法回归测试集 |
| 核心原则 | **LLM 写规约，引擎产数据**：LLM 永不直接生成数据行——它把自然语言编译为生成规约（GenSpec），数据行由确定性引擎执行规约产出。这保证：可复现（seed）、可上量（百万行）、统计可控（分布按规约成立）、可审计（规约即文档） |

## 0. 为什么"接近真实"≠"看起来像"（设计依据）

真实工业数据与玩具数据的差异在四个维度，每个维度对应一类被验证的工程能力：

| 维度 | 真实数据特征 | 验证的能力 |
|---|---|---|
| 统计形态 | 长尾（对数正态交期）、自相关（OEE 是 AR(1) 不是白噪声）、季节/班次效应、Beta 分布良率、Weibull 故障间隔 | 算法（预测/校准在真实分布下的表现） |
| **数据脏污** | 缺失、重复、迟到、单位混用、编码变体、异常值、时钟漂移 | 管线健壮性（这是工程验证的主菜——干净数据测不出任何问题） |
| 口径冲突 | 同一事实在 MES 与 ERP 数值不同（±2–5%） | 治理能力（血缘/仲裁/健康度） |
| 体量 | 单源数十万行、并发同步 | 性能（增量聚合/索引/SLO） |

## 1. GenSpec 规约 DSL（模块的中心资产，版本化存储）

```ts
interface GenSpec {                          // ID 前缀 gen_，(tenantId, key, version) 唯一
  key: string; version: number; seed: number;
  scale: "S" | "M" | "L" | { rows: Record<string, number> };   // L 默认含 ≥10万行时序
  entities: EntityGen[];                     // 实体类数据集
  series: SeriesGen[];                       // 时序类数据集（经 A8 通道写入）
  causality: CausalRule[];                   // 因果传导
  dirt: DirtProfile;                         // 脏污注入
  conflicts?: ConflictRule[];                // 跨源口径冲突
}

interface EntityGen {
  dataset: string; count: number;
  fields: Record<string, FieldGen>;
  refs?: { field: string; toDataset: string; cardinality: "1:N" | "N:N"; skew?: number }[];  // skew：头部集中度(帕累托)
}
type FieldGen =
  | { kind: "normal"; mean: number; sd: number; min?: number; max?: number; precision?: number }
  | { kind: "lognormal"; mu: number; sigma: number }                 // 交期/修复时长
  | { kind: "beta"; a: number; b: number; scaleTo?: [number, number] }   // 良率/利用率
  | { kind: "categorical"; weights: Record<string, number> }
  | { kind: "pattern"; template: string }                            // 如 "SO-{seq:4}"
  | { kind: "llm_text"; prompt: string; maxLen: number }             // 唯一允许 LLM 产内容的字段类型：
                                                                     // 批注/客诉摘要等文本，批量生成后缓存复用
interface SeriesGen {
  seriesKey: string; entityRef: string; grain: "shift" | "day";
  base: { mean: number; noise: number };
  ar1?: number;                              // 自相关系数 0–0.95
  seasonal?: { weekday?: number[]; month?: number[] };   // 乘性系数
  drift?: number;                            // 趋势/天
  effects?: string[];                        // 引用 causality 规则 id
}
interface CausalRule {                       // 事件 → 序列形变（与本体事件对象互相引用）
  id: string; trigger: { event: "maintenance" | "shipment_delay" | "yield_drop" | "demand_surge"; when: string };
  effect: { seriesKey: string; shape: "dip" | "spike" | "step"; magnitude: number; lagDays: number; recoverDays: number };
}
interface DirtProfile {
  preset: "clean" | "typical" | "hostile";   // typical：下表默认值；hostile：×3
  nullRate?: number;            // 默认 0.02   验证：管线空值健壮性
  dupRate?: number;             // 0.005       验证：幂等/去重
  lateArrival?: { rate: number; maxDays: number };  // 0.03/7天  验证：A8 迟到窗口
  unitErrors?: number;          // 0.002（如 吨↔kg 千倍错）  验证：异常检测/健康度
  codeVariants?: number;        // 0.01（"常州基地" vs "常州基地·总部" vs "CZ01"）  验证：主数据对齐（A3）
  outliers?: number;            // 0.005（±5σ）  验证：聚合稳健性/告警
  clockSkewSec?: number;        // 300          验证：乱序容忍
}
interface ConflictRule { fact: string; sources: [string, string]; deltaPct: number }  // MES vs ERP 同事实偏差
```

## 2. 两种创作方式（产出同一 GenSpec）

### 2.1 提示词模式（LLM 编译器）
- 入口：一段自然语言，如 *"造一个中型注塑厂：3 个车间 40 台机、500 个模具 SKU、客户高度集中（前 3 家占 60%）、夏季是旺季、OEE 平均 0.72 且周一明显低、约 3% 数据迟到、ERP 和 MES 的产量有 3% 口径差"*。
- LLM（`claude-opus-4-8`，结构化输出 = GenSpec 的 zod schema）将其编译为 GenSpec 草案；**编译提示词中内置分布选型知识**（交期→lognormal、良率→beta、OEE→AR(1)+weekday 等映射表，作为 system prompt 的领域字典）。
- 编译后强制走 §4 预览-校验循环，人确认后保存；LLM 输出不可直接执行（先过 schema 校验 + 数值合理性 lint：如 beta 参数为正、权重和为 1、count≤规模上限）。

### 2.2 配置器模式（中台 /admin/data-forge）
三栏：数据集树（实体/时序）｜字段生成器编辑面板（分布类型下拉 + 参数表单 + **实时预览直方图/时序小图**，500 样本即时抽样渲染）｜右栏：因果规则编辑、脏污旋钮（preset 三档 + 逐项微调）、冲突规则。顶部"用一句话描述修改"输入框——提示词与配置器**可混用**（NL 增量修改现有 spec：LLM 输出 JSON-Patch，人确认后应用）。

### 2.3 贴样模式（Fit-to-sample，"接近真实"的最高档）
上传真实样本 CSV（脱敏后，≥500 行）→ 画像器拟合：逐字段分布拟合（矩估计 + 候选分布族 KS 检验选优）、字段间相关性（Pearson/Cramér's V 矩阵，保留 |r|>0.3 的对）、时序字段的 AR 系数与季节性 → 自动生成 GenSpec（`calibratedFrom: sampleId`）。**样本只用于拟合参数，不被复制进生成数据**（合规红线：生成数据与样本行零重叠，验收 F6 断言）。

## 3. 生成引擎与数据入口

1. 确定性执行：同 (spec, seed) 字节级同输出；PRNG 用 splitmix64 按 (dataset, row, field) 派生子流——**改一个字段的参数不影响其他字段的随机序列**（局部可调性，调参对比实验的前提）。
2. **数据从正门进**：实体数据写为 A1 的合成连接器（connectorType=`synthetic`）的 RawDataset，时序走 A8 ts 通道——模拟数据与真实数据走**同一条**接入→建模→对象化→聚合管线，管线本身因此被验证（这是与"直接灌库"的本质区别）。
3. 体量流式生成（10 万行/批，背压控制）；L 规模生成 ≤10 分钟。
4. 因果规则执行时**同步创建本体事件对象**（检修计划/到货延迟单），保证"事件↔数据形变"可互相印证（运营态增量 §1.3 的互引要求由此机制统一满足）。

## 4. 真实性校验器（生成后自动出报告）

| 检查 | 方法 | 通过线 |
|---|---|---|
| 分布符合性 | 逐字段 KS 检验（生成数据 vs 规约目标分布） | p>0.05 字段占比 ≥95% |
| 自相关/季节 | 时序 ACF 与规约 ar1 偏差、weekday 系数还原 | 偏差 ≤0.1 |
| 脏污达成率 | 各 dirt 项实际注入率 vs 目标 | ±20% 相对误差 |
| 因果可见性 | 事件窗内序列形变显著性（前后均值 t 检验） | 全部规则显著 |
| 贴样保真（仅 fit 模式） | 生成数据画像 vs 样本画像逐字段对比 | 均值/方差偏差 ≤10%，且零行重叠 |
| 引用完整性 | refs 悬挂率 | =0（脏污中的编码变体除外，单列统计） |

报告落库并展示在配置器内；不通过项标红且**不阻断**（脏数据本来就该"不干净"，报告说明哪些是规约内的故意脏污）。

## 5. 工程验证场景库（模块的最终目的）

预置验证场景 = GenSpec 引用 + 期望系统行为断言，一键运行即工程验证：

| 场景 | 数据 | 验证断言 |
|---|---|---|
| V-PIPE | L 规模 + typical 脏污 | 接入→对象化→聚合全链无 5xx；迟到数据按 A8 窗口正确归位；健康度页显示真实缺陷统计 |
| V-PERF | 50 万行时序 | TS_AGGREGATE 增量重算 ≤60s；驾驶舱查询 P95 ≤2s |
| V-ALGO | AR(1)=0.8 + 已知因果注入 | capacity_forecast 的 MAPE 落在解析可算的期望区间；M11 重放归因把 ≥80% 偏差归到注入因子 |
| V-GOV | 口径冲突 3% + 编码变体 | A3 建模建议给出对齐提示；冲突在血缘/健康度可见 |
| V-HOSTILE | hostile 脏污 | 系统不崩、不静默吞数：全部异常进隔离区并可审计 |

CI 集成：场景库经 API 可由流水线调用（`POST /a/v1/data-forge/scenarios/{id}/run` → 断言结果 JSON）——**工程验证度从"人肉点点看"变成可回归的测试资产**。

## 6. API 与权限

```
POST /a/v1/data-forge/specs                     创建（body=GenSpec 或 { prompt }→LLM 编译）
POST /a/v1/data-forge/specs/{id}/patch-by-prompt  NL 增量修改 → JSON-Patch（人确认后 apply）
POST /a/v1/data-forge/specs/{id}/preview        500 行抽样 + 直方图分桶（配置器实时预览用）
POST /a/v1/data-forge/specs/{id}/generate       → 202 { jobId }（写入合成连接器 + ts 通道）
POST /a/v1/data-forge/fit                       上传样本 → 画像 → 生成 calibrated spec
GET  /a/v1/data-forge/jobs/{id}/realism-report
POST /a/v1/data-forge/scenarios/{id}/run        验证场景执行 → 断言结果
```

权限：`catalog_admin`；生成的数据全部带 `origin=SYNTHETIC` 与 specRef（运营态替换路径、前端水印沿用既有机制）。**生产租户禁用 generate**（环境开关 `FORGE_ALLOW_PROD=0` 默认），防止合成数据混入真实租户。

## 7. 与既有模块的关系（收编声明）

A7 行业模板的 `generation/tsGenerators` 字段、运营态增量 §1.2 的记录清单，统一改为**引用 GenSpec**（行业模板=平台预置的 GenSpec 库）；A8 模拟时钟的 tick 数据生成改为调用本引擎（同一规约管初始回放与逐日推进）。即：平台内只有一套数据生成体系，A9 是它的正式名分。

## 8. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| F1 | 提示词编译（录制 Mock）：注塑厂描述 → GenSpec | 字段映射合理（交期=lognormal、OEE=AR1+weekday）、通过 schema 与 lint；预览直方图形态正确 |
| F2 | 确定性与局部可调 | 同 spec+seed 字节一致；只改 OEE.mean 后其他字段输出不变 |
| F3 | 脏污注入 | typical 档各项注入率 ±20% 内；hostile 下管线不崩（V-HOSTILE） |
| F4 | 正门验证 | 生成数据出现在连接器/RawDataset/对象/聚合各层，血缘完整 |
| F5 | 因果互引 | 检修事件对象与对应 OEE 下凹同窗，t 检验显著 |
| F6 | 贴样模式 | 画像偏差 ≤10%；生成行与样本行零重叠（逐行哈希断言） |
| F7 | 场景库 CI | V-ALGO 断言通过；任一断言失败时输出可定位的 diff 报告 |
| F8 | 口径冲突 | MES/ERP 同事实 3% 偏差生成成立，健康度/血缘可见 |
