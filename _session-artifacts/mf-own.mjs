const B = 'http://127.0.0.1:4001';
const TEN = 'mfco';
const H = { 'X-Debug-User': `${TEN}:planner01:admin`, 'Content-Type': 'application/json' };
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 300) }; } return { status: r.status, body: j }; };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const L = (...a) => console.log(...a);
const prop = (k, pk) => ({ propKey: k, dataType: 'string', isPrimaryKey: !!pk });

// register domain + 2 source types (ErpOrder / MesOrder) + publish
await call('POST', '/a/v1/ontology/domains', { domainKey: 'sales', displayName: '销售' });
for (const key of ['ErpOrder', 'MesOrder']) {
  await call('POST', '/a/v1/ontology/object-types', { key, displayName: key, domain: 'sales', properties: [prop('so', true), prop('due'), prop('asOf')] });
}
await call('POST', '/a/v1/ontology/publish', {});
// materialize 2 sources sharing pk SO-9001, different due (ERP optimistic 09-01, MES actual 09-25)
for (const [key, csv] of [['ErpOrder', 'so,due,asOf\nSO-9001,2026-09-01,2026-06-10'], ['MesOrder', 'so,due,asOf\nSO-9001,2026-09-25,2026-06-28']]) {
  const up = await call('POST', '/a/v1/uploads', { filename: `${key}.csv`, contentBase64: b64(csv) });
  await call('POST', '/a/v1/databuilder/intake/objectify', { connId: up.body?.connection?.id });
}
// invoke multisource_fusion (MES more authoritative)
const args = { role: 'order', fields: ['due'], sources: [{ sourceLabel: 'ERP', typeKey: 'ErpOrder', authority: 1, asOfField: 'asOf' }, { sourceLabel: 'MES', typeKey: 'MesOrder', authority: 3, asOfField: 'asOf' }], defaultStrategy: 'AUTHORITY' };
const inv = await call('POST', '/a/v1/solvers/multisource_fusion/invoke', { args });
const d = inv.body?.data || inv.body;
const fo = d?.fused?.[0];
const due = fo?.fields?.find((f) => f.field === 'due');
L('invoke status:', inv.status);
L('fused pk:', fo?.pk, '| dataMode:', d?.dataMode, '| conflictCount:', d?.conflictCount);
L('due field: chosenSource=' + due?.chosenSource + ' value=' + due?.value + ' conflict=' + due?.conflict + ' confidence=' + due?.confidence);
L('due reason:', due?.reason);
L('due sources:', JSON.stringify((due?.sources || []).map((s) => ({ source: s.source, value: s.value, confidence: s.confidence }))));
// assert C1-C3
const c1 = (due?.sources?.length === 2) && due.sources.every((s) => s.source && s.value !== undefined && s.confidence !== undefined);
const c2 = due?.chosenSource && ['ERP', 'MES'].includes(due.chosenSource) && typeof due.reason === 'string' && due.reason.length > 0;
const c3 = d?.dataMode === 'PARTIAL';
L('\nC1 (2 sources·{source,value,confidence}):', c1 ? 'PASS ✅' : 'FAIL');
L('C2 (verdict chosenSource+reason):', c2 ? 'PASS ✅' : 'FAIL', '(' + due?.chosenSource + ')');
L('C3 (dataMode PARTIAL on conflict):', c3 ? 'PASS ✅' : 'FAIL', '(' + d?.dataMode + ')');

// C5 determinism: rerun, byte-compare
const inv2 = await call('POST', '/a/v1/solvers/multisource_fusion/invoke', { args });
const same = JSON.stringify(inv.body) === JSON.stringify(inv2.body);
L('C5 (determinism·byte-identical rerun):', same ? 'PASS ✅' : 'FAIL');

// audit/fused-objects endpoint
const fused = await call('GET', '/a/v1/fused-objects');
L('\nAUDIT: GET /a/v1/fused-objects status:', fused.status, '| count:', (fused.body?.items || fused.body || []).length ?? '?');
