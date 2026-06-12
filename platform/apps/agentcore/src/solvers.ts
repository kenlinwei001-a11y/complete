/** 求解器（System B）：算法严格按 求解器增量 PRD §S1 实现（确定性，同输入同输出） */
import type { AuthCtx } from "@platform/contracts";
import { dc } from "./tools.js";

const P90F = 0.93;
export const T0 = new Date("2026-06-12T00:00:00Z");
const hashN = (s: string, mod: number) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 997; return x % mod; };
const maintWeek = (b: string) => (b.charCodeAt(0) + b.length * 3) % 8 + 3;
const dueDay = (d: string) => Math.max(1, Math.round((new Date(d).getTime() - T0.getTime()) / 864e5));

/* §S1.2 产能预测 */
const baseWeekly = (base: any) => Math.round(base.gwh * 0.32 * 10) / 10;            // 周产能(万套)≈GWh 派生（骨架口径）
const certFactor = (model: any, baseName: string) => model.certPending?.includes(baseName) ? 0.6 : 1.0;
const curveMult = (b: string, w: number) => { let m = w <= 4 ? 0.88 + 0.03 * (w - 1) : 1.0; if (w === maintWeek(b)) m *= 0.72; return m; };

export const BN_FACTORS = ["瓶颈工序", "设备OEE", "人力工时", "物料齐套", "物流时长", "换型损失", "良率波动"];
const BN_PRIMARY: Record<string, string> = { "常州基地·总部": "瓶颈工序", "厦门基地": "瓶颈工序", "成都基地": "瓶颈工序", "眉山基地": "物料齐套", "武汉基地": "人力工时", "江门基地": "瓶颈工序", "合肥基地": "瓶颈工序", "信阳基地": "物流时长", "枣庄基地": "瓶颈工序", "邯郸基地": "物流时长", "自贡基地": "换型损失", "洛阳基地": "物料齐套" };
/* §S1.3 多维瓶颈紧张度（Mock 口径，dataMode 标注） */
export function bnTight(base: any, f: string) {
  const seed = (base.name.charCodeAt(0) + f.charCodeAt(0) * 7) % 9;
  if (f === BN_PRIMARY[base.name]) return Math.min(97, 88 + seed % 9);
  return Math.min(83, 55 + seed + (base.util > 82 ? 6 : 2));
}

export async function capacity_forecast(ctx: AuthCtx, token: string, args: any) {
  const { modelId, qty, weeks = 6, demandDelta = 0, whatif } = args;
  const models = (await dc(token, "Model", { id: modelId })).data as any[];
  if (!models.length) throw Object.assign(new Error(`型号 ${modelId} 不存在`), { code: "MODEL_NOT_FOUND" });
  const model = models[0];
  const bases = (await dc(token, "Base", {})).data.filter((b: any) => model.bases.includes(b.name));
  const perBaseRows = bases.map((b: any) => {
    const cf = certFactor(model, b.name);
    const wk = baseWeekly(b) * cf;
    let total = 0; for (let w = 1; w <= weeks; w++) total += wk * curveMult(b.name, w);
    const bnF = BN_PRIMARY[b.name] || "瓶颈工序";
    return { base: b.name, weeklyCap: wk, certFactor: cf, maintWeek: maintWeek(b.name), bottleneck: bnF === "瓶颈工序" ? b.bn + "·工序" : bnF, tightness: bnTight(b, bnF), cumTotal: Math.round(total * 10) / 10 };
  });
  let p50 = perBaseRows.reduce((s: number, r: any) => s + r.cumTotal, 0);
  /* §S1.2-7 what-if：夜班+6%/班 · 扩通道+5%/通道 · 外协补量 */
  let outsourceAdd = 0;
  if (whatif) { p50 = p50 * (1 + 0.06 * (whatif.night || 0) + 0.05 * (whatif.channels || 0)); outsourceAdd = (qty || 0) * (whatif.outsource || 0); }
  p50 = Math.round(p50 * 10) / 10;
  const healthFactor = P90F;
  const p90 = Math.round((p50 + outsourceAdd) * healthFactor * 10) / 10;
  const demand = Math.round((qty ?? p50) * (1 + demandDelta) * 10) / 10;
  const gap = Math.round((demand - p90) * 10) / 10;
  const mainBn = [...perBaseRows].sort((a: any, b: any) => b.tightness - a.tightness)[0];
  return { modelId, demand, weeks, p50, p90, healthFactor, gap, ok: gap <= 0, perBaseRows, mainBn, pendingCert: model.certPending || [], dataMode: "MOCK" };
}

/* §S1.5 受影响订单 */
export async function affected_orders(ctx: AuthCtx, token: string, args: any) {
  const { baseName, fromDay = 1, toDay = 30 } = args;
  const orders = (await dc(token, "Order", {})).data as any[];
  const models = (await dc(token, "Model", {})).data as any[];
  const rows = orders
    .filter(o => { const m = models.find(x => x.id === o.model); return m && (!baseName || m.bases.includes(baseName)); })
    .map(o => ({ ...o, d: dueDay(o.due) }))
    .filter(o => o.d >= fromDay - 7 && o.d <= toDay + 14)
    .map(o => ({ so: o.so, cust: o.cust, model: o.model, qty: o.qty, due: o.due, seg: o.seg, delay: Math.max(1, Math.round(10 / 8) + hashN(o.so + (baseName || ""), 4)) }))
    .sort((a, b) => a.due.localeCompare(b.due));
  return { baseName: baseName || "全部可见基地", count: rows.length, totalQty: Math.round(rows.reduce((s, r) => s + r.qty, 0) * 10) / 10, rows };
}

/* §S1.4 风险时序（基线爬升+事件脉冲） */
export async function risk_timeline(ctx: AuthCtx, token: string, args: any) {
  const { baseName, factor = "物料齐套", horizon = 30 } = args;
  const bases = (await dc(token, "Base", {})).data as any[];
  const base = bases.find(b => b.name === baseName);
  if (!base) throw Object.assign(new Error(`基地 ${baseName} 不可见或不存在`), { code: "BASE_NOT_FOUND" });
  const cur = bnTight(base, factor);
  const h = hashN(factor.charCodeAt(0) + "#" + baseName + factor, 10);
  const tgt = h < 4 ? 86 + h * 2 : 58 + h;
  const events: any[] = [];
  const mwDay = maintWeek(baseName) * 7 - 3;
  if ((factor === "设备OEE" || factor === "瓶颈工序") && mwDay <= horizon) events.push({ d: mwDay, amp: 14, tag: "检修窗口", src: "EAM/CMMS" });
  if (factor === "物料齐套" || factor === "物流时长") { const c0 = 11 + hashN(baseName, 4); for (let d = c0; d <= horizon; d += 14) events.push({ d, amp: 10, tag: "到货间隙", src: "WMS/ERP" }); }
  const series: { d: number; v: number }[] = []; let crossDay = 0;
  for (let d = 1; d <= horizon; d++) {
    let v = cur + (tgt - cur) * Math.min(1, d / (horizon * 0.72));
    const ps = Math.max(0.25, 1 - (v - 68) / 45);
    for (const e of events) { const dist = Math.abs(d - e.d); if (dist <= 3) v += e.amp * ps * (1 - dist / 4); }
    v = Math.min(98, Math.round(v));
    if (!crossDay && v >= 85) crossDay = d;
    series.push({ d, v });
  }
  return { baseName, factor, current: cur, target: tgt, series, events, crossDay, peak: Math.max(...series.map(s => s.v)), threshold: 85 };
}

/* §S1.6 规划体检（确定性规则诊断） */
const SEG_MARGIN: Record<string, number> = { 乘用车: 0.18, 储能: 0.13, 商用车: 0.15 };
export async function plan_audit(_ctx: AuthCtx, _token: string, p: any) {
  const d = { dem: 132, seg_pas: 79, seg_ess: 49, seg_com: 4, sup: 129.5, ltaCov: 92, kitGap: 300, gmTarget: 16.0, cashCushion: 58, capex: 6, ...p };
  const H: any[] = [], M: any[] = [];
  const segTot = d.seg_pas + d.seg_ess + d.seg_com;
  const w = { pas: d.seg_pas / segTot, ess: d.seg_ess / segTot, com: d.seg_com / segTot };
  if (Math.abs(segTot - d.dem) > 0.5) H.push({ id: "X01", title: "细分之和 ≠ 总需求", why: `${d.seg_pas}+${d.seg_ess}+${d.seg_com}=${segTot.toFixed(1)} vs 总需求 ${d.dem}`, fix: { label: "按需求比例缩放细分", patch: { seg_pas: +(d.dem * w.pas).toFixed(1), seg_ess: +(d.dem * w.ess).toFixed(1), seg_com: +(d.dem * w.com).toFixed(1) } } });
  const gap = d.dem - d.sup;
  if (gap > 2) H.push({ id: "X02", title: `产销缺口 ${gap.toFixed(1)} 万套（>2）`, why: `需求 ${d.dem} − 供给 ${d.sup} = ${gap.toFixed(1)}，未给对策即承诺则交付违约`, fix: { label: "补夜班+加急采购 (+1.7+1.8)", patch: { sup: +(d.sup + 3.5).toFixed(1) } } });
  else if (gap > 0.3) M.push({ id: "X02", title: `产销缺口 ${gap.toFixed(1)} 万套`, why: "可月内消化，客户优先级取舍需上 S&OP" });
  const gmStruct = (w.pas * SEG_MARGIN.乘用车 + w.ess * SEG_MARGIN.储能 + w.com * SEG_MARGIN.商用车) * 100;
  if (d.gmTarget > gmStruct + 0.3) H.push({ id: "X03", ruleRef: "C15", title: "毛利率目标与细分结构不自洽", why: `目标 ${d.gmTarget}% > 结构反推上限 ${gmStruct.toFixed(1)}%`, fix: { label: `下调至 ${gmStruct.toFixed(1)}%`, patch: { gmTarget: +gmStruct.toFixed(1) } } });
  else if (d.gmTarget > gmStruct - 0.5) M.push({ id: "X03", ruleRef: "C15", title: "毛利率目标贴近结构上限", why: `目标 ${d.gmTarget}% vs 反推 ${gmStruct.toFixed(1)}%，缓冲不足 0.5pct` });
  if (d.kitGap > 800) H.push({ id: "X04", ruleRef: "C06", title: "正极缺口过大将冻结排产", why: `缺口 ${d.kitGap} 吨，库存覆盖<5天将触发 C06`, fix: { label: "追加加急采购 200 吨", patch: { kitGap: Math.max(0, d.kitGap - 200) } } });
  else if (d.kitGap > 0) M.push({ id: "X04", ruleRef: "C16", title: `正极缺口 ${d.kitGap} 吨`, why: "可月内现货补足，执行偏差将反映到下季长协" });
  if (d.cashCushion < 50) H.push({ id: "X05", ruleRef: "C18", title: "现金流安全垫击穿", why: `13周最低点 ${d.cashCushion} 亿 < 50 亿（CAPEX ${d.capex} 亿挤占）`, fix: { label: `CAPEX 缩减至 ${Math.max(0, d.capex - 6)} 亿`, patch: { capex: Math.max(0, d.capex - 6), cashCushion: +(d.cashCushion + 6).toFixed(1) } } });
  else if (d.cashCushion < 55) M.push({ id: "X05", ruleRef: "C18", title: "现金垫余量薄", why: `仅高于红线 ${(d.cashCushion - 50).toFixed(0)} 亿` });
  if (Math.abs(w.ess - 49 / 132) > 0.05) M.push({ id: "R01", ruleRef: "C21", title: "储能占比偏离基线", why: `储能占比 ${(w.ess * 100).toFixed(0)}% vs 基线 37%` });
  if (d.capex >= 10) M.push({ id: "R02", ruleRef: "C23", title: "CAPEX 上量需 C23 校验", why: `CAPEX ${d.capex} 亿需 IRR≥15% 且 24月利用率≥75%` });
  const score = Math.max(0, Math.min(100, 100 - 25 * H.length - 8 * M.length));
  return { input: d, score, verdict: score >= 85 ? "通过" : score >= 60 ? "有条件通过" : "不通过", hard: H, medium: M, suggestions: H.filter(x => x.fix).map(x => x.fix.label) };
}

/* §S1.7 规划建议（五路径三方案） */
const GEN_PATHS = [
  { id: "A", n: "保毛利型", eff: { rev: 1.12, gm: 1.4, share: 6, capex: 0, cashD: 6 } },
  { id: "B", n: "保规模型", eff: { rev: 1.22, gm: -0.8, share: 16, capex: 2, cashD: -4 } },
  { id: "C", n: "扩产型", eff: { rev: 1.20, gm: 0.2, share: 22, capex: 27, cashD: -12 } },
  { id: "D", n: "外协型", eff: { rev: 1.16, gm: -0.5, share: 12, capex: 0, cashD: 2 } },
  { id: "E", n: "混合型", eff: { rev: 1.18, gm: 0.4, share: 14, capex: 14, cashD: -2 } },
];
export async function plan_generate(_ctx: AuthCtx, _token: string, args: any) {
  const g = { gmFloor: 15.5, cashFloor: 50, capexCap: 20, ...args };
  const base = { rev: 2980, gm: 16.0, cash: 58 };
  const all = GEN_PATHS.map(p => {
    const gm = base.gm + p.eff.gm, cash = base.cash + p.eff.cashD, revGrow = (p.eff.rev - 1) * 100;
    const hardViol: string[] = [];
    if (gm < g.gmFloor) hardViol.push(`C15 毛利率 ${gm.toFixed(1)}% < 底线 ${g.gmFloor}%`);
    if (cash < g.cashFloor) hardViol.push(`C18 现金垫 ${cash.toFixed(0)} < 底线 ${g.cashFloor}`);
    if (p.eff.capex > g.capexCap) hardViol.push(`CAPEX ${p.eff.capex} > 上限 ${g.capexCap}`);
    const sc = {
      盈利: Math.max(0, Math.min(100, 50 + (gm - g.gmFloor) * 22)),
      规模: Math.max(0, Math.min(100, 40 + p.eff.share * 3)),
      现金: Math.max(0, Math.min(100, 50 + (cash - g.cashFloor) * 4)),
      增长: Math.max(0, Math.min(100, 30 + revGrow * 2.5)),
      稳健: Math.max(0, Math.min(100, 90 - p.eff.capex * 2.2)),
    };
    const total = Math.max(0, Math.round(Object.values(sc).reduce((a, b) => a + b, 0) / 5) - 15 * hardViol.length);
    return { pathId: p.id, name: p.n, outcome: { revGrow, gm: +gm.toFixed(1), cash: +cash.toFixed(1), share: p.eff.share, capex: p.eff.capex }, scores: sc, total, hardViol };
  });
  const plans = [{ no: "稳健", ...all[0] }, { no: "均衡", ...all[4] }, { no: "进取", ...(all[2].total >= all[1].total ? all[2] : all[1]) }];
  const ok = plans.filter(p => !p.hardViol.length);
  const recommended = (ok.length ? ok : plans).sort((a, b) => b.total - a.total)[0].no;
  return { goals: g, plans, recommended };
}

export const SOLVERS: Record<string, (ctx: AuthCtx, token: string, args: any) => Promise<any>> = {
  capacity_forecast, affected_orders, risk_timeline, plan_audit, plan_generate,
};
