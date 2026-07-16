const B = 'http://127.0.0.1:4001';
const H = { 'X-Debug-User': 'realco4:ceo:admin', 'Content-Type': 'application/json' };
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0,200) }; } return { status: r.status, body: j }; };
// C4a: bind ghost TYPE → 400 grounding fail
const ghostType = await call('POST', '/a/v1/solvers/order_fullchain/bindings', { roleBindings: [{ role: 'order', typeKey: 'GhostType' }] });
console.log('C4a bind ghost type:', ghostType.status, '| msg:', (ghostType.body?.error?.message || '').slice(0, 120));
// C4b: bind ghost FIELD → 400 grounding fail
const ghostField = await call('POST', '/a/v1/solvers/order_fullchain/bindings', { roleBindings: [{ role: 'order', typeKey: 'SalesOrder', fieldMap: { so: 'ghostField' } }] });
console.log('C4b bind ghost field:', ghostField.status, '| msg:', (ghostField.body?.error?.message || '').slice(0, 120));
// C4c: confirm NOT persisted (list bindings, no GhostType)
const list = await call('GET', '/a/v1/solvers/order_fullchain/bindings');
const items = list.body?.items || list.body || [];
const arr = Array.isArray(items) ? items : [];
const ghostPersisted = arr.some((b) => (b.roleBindings || []).some((rb) => rb.typeKey === 'GhostType' || (rb.fieldMap && Object.values(rb.fieldMap).includes('ghostField'))));
console.log('C4c bindings count:', arr.length, '| ghost persisted:', ghostPersisted, '(expect false)');
const pass = ghostType.status === 400 && /接地失败|本体外|不在本租户/.test(ghostType.body?.error?.message || '') && ghostField.status === 400 && !ghostPersisted;
console.log(pass ? 'C4 PASS ✅ — DF.8 接地：绑外部实体 400 不落库' : 'C4 CHECK — see above');
