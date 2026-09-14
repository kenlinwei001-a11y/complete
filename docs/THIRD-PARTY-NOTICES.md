# Third-Party Notices · 第三方借鉴与许可署名

> 本文件登记平台**借鉴的第三方开源项目、其许可证、我们借鉴了什么、以何种方式**，以满足许可证的署名义务（尤其 MIT 要求"保留版权与许可声明"）并守住合规红线。**本文件中出现的上游产品/组织名仅为法律署名所必需**（与平台"禁用外部产品名作平台术语"约定不冲突——那是术语命名约定，此处是法律署名义务）。
>
> 借鉴总纲（三条红线）：**① 借鉴=重写方法 + 派生产物 + 评测，绝不把上游内容用作任何模型的训练/微调语料；② Gurobi 版权示例完全不碰、不移植、不转发；③ 数据集只取派生 Results（CDLA-2.0 §3 无限制），不原样转发上游数据文件。**

---

## 1. 参考优化推演项目（Supply-Chain What-if / MILP-Evolve / OptiMind 伞下项目）

- **来源**：Microsoft OptiGuide（GitHub: microsoft/OptiGuide）。
- **相关论文**：《Large Language Models for Supply Chain Optimization》(arXiv:2307.03875) · 《Towards Foundation Models for Mixed Integer Linear Programming》(ICLR 2025, arXiv:2410.08288) · 《OptiMind: Teaching LLMs to Think Like Optimization Experts》(arXiv:2509.22979)。

### 1.1 代码（what-if / optimind 子项目）—— 许可证：MIT

```
MIT License
Copyright (c) Microsoft Corporation.

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

- **我们借鉴了什么**：① "NL 问题 → 修改优化模型 → 重解 → 对比目标值 → 解释"的 **what-if 回路思想**；② "在标记注入点改 data/constraint" 的结构思想；③ optimind 的 "求解器反馈→自纠正" 回路思想。
- **以何种方式**：**全部用 TypeScript 在本平台栈内重新实现**（语言/栈不同，借的是方法与思想，非具体代码表达），并**收敛进本平台安全栈**——把上游"`exec` 任意 LLM 代码 + LLM 判 SAFE"换成"**结构化扰动 schema + A18 锁子进程 + DF.8 接地 + R6 确定性**"。落地见 `docs/SPEC-optimization-template-pool.md`。

### 1.2 数据集（MILP-Evolve）—— 许可证：CDLA-2.0（Community Data License Agreement – Permissive 2.0）

- **CDLA-2.0 关键条款**：可使用/修改/分享数据；**若原样分享数据须附 CDLA-2.0 全文**；**§3「No Restrictions on Results」——从数据派生的 Results 无任何限制**。
- **我们借鉴了什么**：参考数据集中 ~485 个 OR 模型类（去重为 ~9 个核心族）的**数学结构** + 99 个行业应用的**映射启发**。
- **以何种方式**：**只取派生 Results**——读懂结构后用 OR-Tools CP-SAT **重新表达**为本平台自有的抽象优化模板（`OptModelTemplate`），并据此派生行业租户配置。**不原样转发上游 `.py` 数据文件**（故不触发"附 CDLA 全文"的转发义务；如未来确需转发原始文件，则须随附 CDLA-2.0 全文）。

### 1.3 不含 / 不碰的部分

- **Gurobi 基准示例**（diet/facility/netflow/tsp/workforce1）：上游 README 明示"copyrighted by Gurobi"，由其 `download.py` 拉取、非上游所有。**本平台完全不碰、不移植、不转发**；本平台优化底座用开源 OR-Tools CP-SAT，本不需要。
- **上游 benchmark QA / 模型 / 数据集**：**绝不用作任何模型的训练/微调语料**（守上游 "Prohibitions" 第 1 条）。允许的用途仅限：运行时模板派生灵感、评测（上游明确许可）、代码方法参考。

---

## 2. 合规自检（`solver-license:check` 门强制）

- [ ] 新增优化模板/求解器均带 `provenance.{derivedFrom,license}` 且在本文件登记。
- [ ] 仓库内**无** Gurobi 示例文件（指纹比对）。
- [ ] 仓库内**无**把上游内容导入训练/微调管线的调用（如 `fit(`/`train(` 喂入上游数据）。
- [ ] 若引入原样上游数据文件 → 随附 CDLA-2.0 全文。
- [ ] MIT 版权声明（上）随借鉴代码保留。

---

## 3. 一句话

**借鉴=重写方法 + 派生产物（CDLA Results 无约束）+ 评测（上游许可）；MIT 保留署名、Gurobi 不碰、绝不训练。** 合规由 `docs/SPEC-optimization-template-pool.md §8` + 门 `solver-license:check` 守。
