# 第三方许可证与合规声明（THIRD-PARTY-NOTICES）

本平台的「优化求解器融合」轨借鉴外部开源优化推演项目的**方法**，并以其行业 OR 模型数据集为**派生灵感**。
本文件登记所借鉴来源的许可证义务与本平台的合规边界。门 `solver-license:check`（并入 `pnpm gates`）
对下列红线做静态断言；本体登记见 `docs/SYSTEM-ONTOLOGY.md §7`（门）/`§8`（G-12）。

## 1. 借鉴来源与许可证

| 来源（类别） | 许可证 | 本平台用法 | 义务 |
|---|---|---|---|
| 参考开源优化推演项目（what-if / 模型生成方法） | MIT | **重写方法进 TS**（CP-SAT 重表达），不拷贝上游源码 | 保留 MIT 版权声明（见 §4） |
| 参考行业 OR 模型数据集（485 类 / 99 行业皮） | CDLA-Permissive-2.0 | **仅取派生 Results**（我们自建的抽象模板 / 租户绑定），不原样转发上游数据文件 | 派生产物无附加义务；转发原始数据才需附 CDLA 文本 |
| 商业求解器基准示例（Gurobi 版权例） | 商业（非己有） | ⛔ **不碰、不移植、不转发** | 不得出现于代码库 |

## 2. 合规红线（硬约束 · `solver-license:check` 守）

- **LIC1 不训练**：绝不把上游任何内容（QA 对 / 模型 / benchmark / 数据集）喂进任何模型的训练或微调管线。
  运行时用 LLM **生成**模板（§7 进化器）、做评测、做代码参考 = 可以；作为**训练语料** = 禁止。
- **LIC2 Gurobi 不碰**：不移植、不转发任何 Gurobi 版权基准示例；代码库不得出现 `gurobipy` / `GRB.` 等指纹。
- **LIC3 MIT 署名**：借鉴的 MIT 方法以重写形式落地，并在本文件 §4 保留版权声明。
- **LIC4 CDLA 取 Results**：只取派生产物；不原样转发上游 `.py` / 原始数据文件。

## 3. 平台侧产物的派生留痕

- 每个 `OptModelTemplate`（`packages/contracts/src/opt-template.ts`）必须带
  `provenance: { derivedFrom, license }`——记录其派生来源与许可证，供 `solver-license:check` 校验。
- 9 个初始 OR 核心模板（facility_location / min_cost_flow / set_cover / independent_set /
  assignment / scheduling / knapsack / packing / combinatorial_auction）均为 **DERIVE**
  （读懂结构 → CP-SAT 重表达），非拷贝上游代码。

## 4. MIT 版权声明（借鉴方法来源）

```
MIT License

Copyright (c) the upstream optimization-reasoning project authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
