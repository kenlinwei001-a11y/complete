# 推演沙盘四页 · UX 规格（**规格就是这些文件本身**）

仓主 2026-08-21 定的验收线：**1:1 像素级复刻**。
所以本目录不是「设计说明」，是**可执行的规格**：四个 HTML 打开就是目标屏，
四张 PNG 是 1440×897 的基准渲染。

## 文件

| 文件 | 对应页面 | 基准 PNG |
|---|---|---|
| `sandbox-home.html` | 首页（左 扰动因素 · 中 端到端流程图 · 下 指标） | `pg1.png` |
| `sandbox-detail.html` | 传导识别 + 应对策略 | `pg2.png` |
| `sandbox-attr.html` | 损失归因 | `pg3.png` |
| `sandbox-opt.html` | 方案寻优 | `pg4.png` |

## 怎么用（前端 dev 必读）

**这些是要移植的，不是要重新解释的。**
`px` 值、`grid-template-columns`、`height`、`font-size` 逐个照抄进 CSS Module。
自己重新排一版「差不多的」= 一定不是 1:1。

### 唯一允许改的两件事
1. **色值** —— HTML 里已经全部换成产品 token 的真值
   （`--bg #223251` / `--panel #2c3d5e` / `--panel2 #1c2942` / `--txt #e9eef5` / `--accent #4c90f0`
   / `--ok #62be77` / `--warn #e8b54a` / `--danger #e0626c` / `--c-capacity #43b7d7`，
   逐值取自 `apps/frontend-shell/src/styles/tokens.css`）。
   移植时**改成引用 `var(--bg)` 等 token**，不许把十六进制抄进组件。
2. **数据** —— HTML 里的数字是占位。移植时换成真实端点，**形状不许变**。

### 复刻基准
```bash
# 渲染基准（本目录的 HTML）
/opt/pw-browsers/chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1440,984 --virtual-time-budget=6000 \
  --screenshot=ref.png file://$PWD/docs/ux-spec/sandbox/sandbox-home.html
# 上下裁到 897：crop((0,0,w,round(h*897/984)))
```
把 React 页面按同样参数渲染成 `got.png`，逐像素比 `ref.png`。

## 为什么把 HTML 提交进仓库

规格写成文字会被读歪，写成截图会被照着"大概画"。
**只有可执行的那份不会。** 下一个人要改版面，改的是这里，然后重出基准 PNG ——
而不是去猜三个月前的截图当时是怎么想的。

## 已知的取舍（照实说，别当 bug 修）

- **竖排组名逐字换行**，没用 `writing-mode: vertical-rl`。
  容器里的字体（WQY）无竖排度量，竖排下每字前进量为 0，三个字会叠成一个黑块。
  真浏览器里 `writing-mode` 可能正常 —— 但**逐字换行在任何字体下都成立**，所以选它。
- **页2 左侧地铁图被面板边界裁切**，段名（需求/订单/产能/物料/交付）看不见。
  这是照参考图「地图延续出画面」的效果，不是渲染缺陷。
- **四页的数字是内部自洽的一套占位**（产能 −18% → 稼动率 −18.0pp → Q3 缺口 6 万套 → 外协 ¥1,840万），
  接真数据时整套换掉，别只换一半 —— 换一半屏上就自相矛盾。
