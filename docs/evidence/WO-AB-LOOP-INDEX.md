# 根因认定 LOOP 产物索引（Run wf_e712d236-7e7 · 2026-10-06）

三角色：**A 发现根因 → B 独立评估 → C 终审/仲裁**。第 1 轮三方一致 ⇒ 停。
`A` 的产物原名 `WO-AB-SATPROJ-*`（已在册）；`B`/`C` 的产物本单从 `/tmp` 搬运入册，**保留 `B-`/`C-` 前缀以标明产出者**（可追溯谁跑的，不是一锅粥）。

## A（发现者）
| 文件 | 是什么 |
|---|---|
| `WO-AB-SATPROJ-probe.mjs` / 同名 txt+rc | 主探针：逐拍读 raw/value/saturations |
| `WO-AB-SATPROJ-DISABLE-probe.mjs` | 关边臂（关掉唯一入边） |
| `WO-AB-SATPROJ-closure.mjs` | 闭式自复算 |
| `WO-AB-SATPROJ-CLOSURE.txt` | 闭式对照读数 |

## B（评估者，复核 + 两组 A 没做的体外判别试验）
| 文件 | 是什么 |
|---|---|
| `B-SATPROJ-m3/m1-t3/DISABLE-m3` | 复跑 A 的 falsifiablePrediction（三条全中） |
| `B-check.mjs` | **B 自写** f 重算（不引用 A 的脚本）—— raw 偏差 ≤9.4e-13 |
| `B-cliff.mjs` / `B-cliff.txt` / `B-cliff-zero.txt` | ★ **拐点悬崖普查**：24 张同型号单，base≤75 的 22 张只动 +0.0206；base=76/80/90.3846 → −0.0749/−1.5094/−8.0931（5 张逐位同） |
| `B-churn-probe.mjs` / `B-churn*.txt` | ★ **零扰动臂 churn 格闭式复算**：amount 3e-4 量级即触发投影 + 收敛到复合不动点；两套独立仪表吻合 ≤7.6e-13 |

## C（终审，自建 6 session / 自写 4 脚本，全程只读自己的 session）
| 文件 | 是什么 |
|---|---|
| `C-SATPROJ-m3/m1/m20/zero/DISABLE-m3` | 独立复跑五臂 |
| `C-cliff.mjs` / `C-cliff.txt` | 独立版跨格悬崖普查 |
| `C-closure.mjs` / `C-closure-m3.txt` | 独立闭式复算 |
| `C-fixedpoint.txt` | 不动点复算 |
| `C-leaddays-probe.mjs` / `C-leaddays.txt` | leadDays 链独立核对 |
| `C-pert-apply-probe.mjs` / `C-pert-apply.txt` | 扰动施加路径 |
| `C-zero-census.mjs` / `C-zero-census.txt` | 零扰动臂普查 |

## ⚠ 证据完整性如实标注（⛔ 不补编）
- `B-closure-rerun.txt` **无配对 .rc** —— 该次运行产出方未落 `.rc`，本单如实标缺（已写 `B-closure-rerun.rc` 记 `RC_NOT_CAPTURED`），**不补编一个 0 冒充"已捕获"**。
- `C-obj-SO3391.rc`、`C-zerocensus-world.rc` **有 rc 无同名 txt** —— 同样是如实状态。
- 其余 19 件 txt/rc 配对齐全。

## 结论档
`WO-AB-ROOTCAUSE-CONVERGED.md` —— 三方一致的主张、机制链四步、闭式、B 的体外判据、C 登记的修复轮可证伪判据。
