#!/usr/bin/env node
// WO-MULTIHOP-TRACE · 04 把 events(SSE) 解析成：帧型统计 / 思考段原文 / 非思考时间线
// 用法: node 04-render-think.js <events.sse> <outdir>
const fs = require('fs');
const path = require('path');

const [, , SSE, OUTDIR] = process.argv;
if (!SSE || !OUTDIR) { console.error('usage: node 04-render-think.js <events.sse> <outdir>'); process.exit(2); }
const raw = fs.readFileSync(SSE, 'utf8');

// ---- SSE 解析 ----
const frames = [];
for (const block of raw.split('\n\n')) {
  let id = null, event = null, dataLines = [];
  for (const ln of block.split('\n')) {
    if (ln.startsWith('id: ')) id = ln.slice(4);
    else if (ln.startsWith('event: ')) event = ln.slice(7);
    else if (ln.startsWith('data: ')) dataLines.push(ln.slice(6));
  }
  if (event) {
    let data = null, parseErr = null;
    const joined = dataLines.join('\n');
    try { data = JSON.parse(joined); } catch (e) { parseErr = e.message; }
    frames.push({ id, event, data, parseErr, rawLen: joined.length });
  }
}

const byEvent = {};
const byType = {};
for (const f of frames) {
  byEvent[f.event] = (byEvent[f.event] || 0) + 1;
  const t = (f.data && f.data.type) || `(event:${f.event})`;
  byType[t] = (byType[t] || 0) + 1;
}

// ---- 思考段：agent_think 按 stepId 依首次出现顺序归段，delta 顺序拼接 ----
const thinkSegs = new Map(); // stepId -> {chars, frames}
let thinkFrames = 0;
for (const f of frames) {
  if (f.data && f.data.type === 'agent_think') {
    thinkFrames++;
    const sid = f.data.stepId || '(no-stepId)';
    if (!thinkSegs.has(sid)) thinkSegs.set(sid, { chars: 0, frames: 0, text: '' });
    const seg = thinkSegs.get(sid);
    seg.chars += (f.data.text || '').length;
    seg.frames++;
    seg.text += (f.data.text || '');
  }
}

// ---- 非思考时间线（工具调用与路由等） ----
const timeline = [];
for (const f of frames) {
  const t = f.data && f.data.type;
  if (t === 'agent_think' || t === 'agent_narration') continue;
  const d = f.data || {};
  const bits = [`${f.event}`, `type=${t || '-'}`, `stepId=${d.stepId || '-'}`];
  if (d.outcome !== undefined) bits.push(`outcome=${String(d.outcome).slice(0, 200)}`);
  if (d.durationMs !== undefined) bits.push(`durationMs=${d.durationMs}`);
  if (d.path !== undefined) bits.push(`path=${d.path}`);
  if (d.note !== undefined) bits.push(`note=${d.note}`);
  timeline.push(`[#${f.id}] ` + bits.join(' | '));
}

// ---- 落盘 ----
fs.mkdirSync(OUTDIR, { recursive: true });
const stats = [];
stats.push(`SSE 文件: ${path.resolve(SSE)}`);
stats.push(`总帧数: ${frames.length}`);
stats.push(`解析失败帧: ${frames.filter(f => f.parseErr).length}`);
stats.push('');
stats.push('— 按 event 行分类 —');
for (const k of Object.keys(byEvent).sort((a, b) => byEvent[b] - byEvent[a])) stats.push(`  ${k}: ${byEvent[k]}`);
stats.push('');
stats.push('— 按 data.type 分类 —');
for (const k of Object.keys(byType).sort((a, b) => byType[b] - byType[a])) stats.push(`  ${k}: ${byType[k]}`);
stats.push('');
stats.push('— 金丝雀 —');
stats.push(`agent_think 帧数: ${thinkFrames}  (判据①: 必须 > 0；正对照=总帧数 ${frames.length} > 0，说明解析器能出数)`);
stats.push(`agent_think 段数(按 stepId 归段): ${thinkSegs.size}`);
fs.writeFileSync(path.join(OUTDIR, '04-events-stats.txt'), stats.join('\n') + '\n');

const out = [];
let si = 0;
for (const [sid, seg] of thinkSegs) {
  si++;
  out.push(`===== 思考段 ${si} | stepId=${sid} | 帧=${seg.frames} | 字符=${seg.chars} =====`);
  out.push(seg.text);
  out.push('');
}
fs.writeFileSync(path.join(OUTDIR, '04-think-segments.txt'), out.join('\n'));
fs.writeFileSync(path.join(OUTDIR, '04-timeline.txt'), timeline.join('\n') + '\n');

console.log(stats.join('\n'));
console.log('---');
console.log(`思考段文件: 04-think-segments.txt (${thinkSegs.size} 段)`);
console.log(`时间线文件: 04-timeline.txt (${timeline.length} 行)`);
