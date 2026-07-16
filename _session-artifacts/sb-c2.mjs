const B = 'http://127.0.0.1:4001';
const H = { 'X-Debug-User': 'realco2:ceo:admin', 'Content-Type': 'application/json' };
const j = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let parsed; try { parsed = JSON.parse(t); } catch { parsed = { _raw: t.slice(0, 400) }; }
  return { status: r.status, body: parsed };
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const log = (...a) => console.log(...a);

// upload+objectify one dataset, return materialized types
async function ingest(filename, csv) {
  const up = await j('POST', '/a/v1/uploads', { filename, contentBase64: b64(csv) });
  const connId = up.body?.connection?.id;
  const obj = await j('POST', '/a/v1/databuilder/intake/objectify', { connId });
  return { connId, connectorTypeKey: up.body?.connection?.connectorTypeKey, materialized: obj.body?.materialized || obj.body };
}

// 4 realco datasets with NON-canonical column names (so canonical Order/Model/... stay empty)
const r1 = await ingest('sales-orders.csv',
  'orderNo,productCode,qtyGwh,wantDate,buyer,creditRatio\nRO-2001,S192-PACK,500,2026-09-01,北方储能,0.6\nRO-2002,L148-TRUCK,120,2026-10-01,华东物流,0.4');
log('① orders ingest:', JSON.stringify(r1));
const r2 = await ingest('product-models.csv',
  'code,plants\nS192-PACK,"常州;宜宾"\nL148-TRUCK,"武汉"');
log('② models ingest:', JSON.stringify(r2));
const r3 = await ingest('segment-demand.csv',
  'seg,gm,gmFloor\n储能,8,12\n商用车,18,10');
log('③ segments ingest:', JSON.stringify(r3));
const r4 = await ingest('mat-balance.csv',
  'mat,shortTon,eta\n碳酸锂,30,2026-08-20');
log('④ materials ingest:', JSON.stringify(r4));

// list published types
const types = await j('GET', '/a/v1/ontology/object-types');
const tlist = (Array.isArray(types.body) ? types.body : types.body?.items || []);
log('published types:', tlist.map((t) => `${t.key}(${t.status})[${(t.properties || []).map((p) => p.propKey).join(',')}]`).join(' | '));
