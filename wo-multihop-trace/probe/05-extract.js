#!/usr/bin/env node
// WO-MULTIHOP-TRACE · 05 汇总：classification/path / agent-runs / decision-trace / answer
// 用法: node 05-extract.js <outdir>
const fs = require('fs');
const path = require('path');
const OUTDIR = process.argv[2];
if (!OUTDIR) { console.error('usage: node 05-extract.js <outdir>'); process.exit(2); }
const J = f => { try { return JSON.parse(fs.readFileSync(path.join(OUTDIR, f), 'utf8')); } catch (e) { return { __err: e.message }; } };

const lines = [];
const push = s => { lines.push(s); };

// 1) detail（终态）
const fin = J('02-final.json');
push('########## 1) 终态 detail ##########');
push('status: ' + (fin.status || '(none)'));
push('path: ' + (fin.path || '(none)'));
push('classification 原文: ' + JSON.stringify(fin.classification || null));
const ans = fin.answer || {};
push('answer.trustLevel: ' + (ans.trustLevel || '(none)'));
push('answer.stats: ' + JSON.stringify(ans.stats || null));
push('provenance 条数: ' + ((ans.provenance || []).length));
push('unverifiedNumerics: ' + JSON.stringify(ans.unverifiedNumerics === undefined ? '(字段缺失)' : ans.unverifiedNumerics));
push('resolvedRefs: ' + JSON.stringify(fin.resolvedRefs === undefined ? '(字段缺失)' : fin.resolvedRefs).slice(0, 2000));
push('');

// 2) agent-runs
const runs = J('03-agent-runs.json');
push('########## 2) agent-runs ##########');
const runArr = Array.isArray(runs) ? runs : (runs.runs || []);
if (runs.__err) push('读取失败: ' + runs.__err);
push('run 条数: ' + runArr.length);
for (const r of runArr) {
  push(`run: kernel=${r.kernel} agentKey=${r.agentKey} agentId=${r.agentId} model=${r.model} iterations=${r.iterations} budgetExhausted=${r.budgetExhausted} inTokens=${r.totalInputTokens} outTokens=${r.totalOutputTokens} origin=${r.origin}`);
  push('  attribution: ' + JSON.stringify(r.attribution || null).slice(0, 500));
}
push('');

// 3) decision-trace
const dt = J('03-decision-trace.json');
push('########## 3) decision-trace ##########');
push('decisionId: ' + dt.decisionId);
push('status: ' + dt.status + ' path: ' + dt.path);
push('classification: ' + JSON.stringify(dt.classification || null));
push('provenanceCount: ' + dt.provenanceCount);
push('unverifiedNumerics: ' + JSON.stringify(dt.unverifiedNumerics === undefined ? '(字段缺失)' : dt.unverifiedNumerics));
push('trustLevel: ' + dt.trustLevel);
push('ontologyValidation: ' + JSON.stringify(dt.ontologyValidation === undefined ? '(字段缺失)' : dt.ontologyValidation).slice(0, 400));
push('humanReviewRequired: ' + dt.humanReviewRequired);
const tc = dt.toolCalls || [];
push(`toolCalls n=${tc.length}（原始逐条，含全部字段）:`);
tc.forEach((t, i) => push(`  [${i}] ${JSON.stringify(t)}`));
push('');

// 4) answer blocks 原文
push('########## 4) answer.blocks 原文 ##########');
(ans.blocks || []).forEach((b, i) => {
  push(`----- block[${i}] type=${b.type} -----`);
  push(String(b.markdown || JSON.stringify(b)).slice(0, 6000));
  push('');
});

fs.writeFileSync(path.join(OUTDIR, '05-summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n').slice(0, 3000));
