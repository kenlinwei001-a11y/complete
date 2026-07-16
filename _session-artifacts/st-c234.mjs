import { createHash } from 'node:crypto';
const B = 'http://127.0.0.1:4001';
const H = { 'X-Debug-User': 'demo:admin:admin' };
const connId = (await import('node:fs')).readFileSync('/tmp/st-synconn.txt', 'utf8').trim();
const getJson = async (p) => { const r = await fetch(B + p, { headers: H }); return { status: r.status, body: await r.json() }; };

// C2: raw datasets >= 8, each rowCount > 0
const rd = await getJson(`/a/v1/raw-datasets?connId=${connId}`);
const dsets = rd.body?.items || rd.body || [];
const arr = Array.isArray(dsets) ? dsets : [];
console.log('C2 raw-datasets count:', arr.length, '(expect >=8)');
console.log('  names:', arr.map((d) => `${d.name}(${d.rowCount})`).join(', ').slice(0, 200));
const allRows = arr.every((d) => (d.rowCount ?? 0) > 0);
const hasKey = ['Order', 'Base', 'Line', 'Process'].filter((k) => arr.some((d) => d.name === k || d.name?.includes(k)));
console.log('  all rowCount>0:', allRows, '| covers Order/Base/Line/Process:', hasKey.join(','));
console.log('  C2', arr.length >= 8 && allRows ? 'PASS ✅' : 'CHECK');

// pick the Order dataset (or first)
const order = arr.find((d) => d.name === 'Order') || arr[0];
console.log('export target dataset:', order?.name, order?.id);

// C3: export xlsx → 200, content-type, filename .synthetic.xlsx, PK magic, rows non-empty
const r3 = await fetch(`${B}/a/v1/raw-datasets/${order.id}/export?format=xlsx`, { headers: H });
const buf = Buffer.from(await r3.arrayBuffer());
const ct = r3.headers.get('content-type');
const cd = r3.headers.get('content-disposition');
const pk = buf.slice(0, 2).toString('latin1') === 'PK';
console.log('\nC3 export xlsx: status', r3.status);
console.log('  content-type:', ct);
console.log('  content-disposition:', cd);
console.log('  PK magic (real zip/xlsx):', pk, '| bytes:', buf.length);
const c3pass = r3.status === 200 && /spreadsheetml.sheet/.test(ct || '') && /\.synthetic\.xlsx/.test(cd || '') && pk && buf.length > 500;
console.log('  C3', c3pass ? 'PASS ✅' : 'CHECK');

// C4: determinism — two exports byte-identical (sha256)
const e1 = Buffer.from(await (await fetch(`${B}/a/v1/raw-datasets/${order.id}/export?format=xlsx`, { headers: H })).arrayBuffer());
const e2 = Buffer.from(await (await fetch(`${B}/a/v1/raw-datasets/${order.id}/export?format=xlsx`, { headers: H })).arrayBuffer());
const h1 = createHash('sha256').update(e1).digest('hex');
const h2 = createHash('sha256').update(e2).digest('hex');
console.log('\nC4 determinism: sha256 run1', h1.slice(0, 16), '| run2', h2.slice(0, 16), '| identical:', h1 === h2);
console.log('  C4', h1 === h2 ? 'PASS ✅' : 'FAIL ❌ (byte drift)');

// save one export for inspection
(await import('node:fs')).writeFileSync('/tmp/st-order-export.xlsx', e1);
console.log('\nsaved /tmp/st-order-export.xlsx for unzip inspection');
