const B = 'http://127.0.0.1:4001';
const TEN = 'realco4';
const H = { 'X-Debug-User': `${TEN}:ceo:admin`, 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = { _raw: t.slice(0, 300) }; }
  return { status: r.status, body: p };
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const L = (...a) => console.log(...a);
const prop = (propKey, dataType, pk) => ({ propKey, dataType, isPrimaryKey: !!pk });

// ---- 0. register domains (fresh tenant B2 friction) ----
for (const [domainKey, displayName] of [['sales','销售域'],['product','产品域'],['material','物料域']]) {
  const r = await call('POST', '/a/v1/ontology/domains', { domainKey, displayName });
  L(`register domain ${domainKey}: ${r.status}`);
}

// ---- 1. create + publish 4 non-canonical types (realco 真实类型) ----
const types = [
  { key: 'SalesOrder', displayName: '销售订单', domain: 'sales', properties: [prop('orderNo','string',true),prop('productCode','string'),prop('qtyGwh','number'),prop('wantDate','string'),prop('buyer','string'),prop('creditRatio','number')] },
  { key: 'ProductModel', displayName: '产品型号', domain: 'product', properties: [prop('code','string',true),prop('plants','json')] },
  { key: 'SegmentDemand', displayName: '细分需求', domain: 'sales', properties: [prop('seg','string',true),prop('gm','number'),prop('gmFloor','number')] },
  { key: 'MatBalance', displayName: '物料平衡', domain: 'material', properties: [prop('mat','string',true),prop('shortTon','number'),prop('eta','string')] },
];
for (const t of types) {
  const r = await call('POST', '/a/v1/ontology/object-types', t);
  L(`create type ${t.key}: ${r.status} ${r.body?.error?.message || r.body?.key || ''}`);
}
const pub = await call('POST', '/a/v1/ontology/publish', {});
L('publish:', pub.status, JSON.stringify(pub.body).slice(0, 160));
const tl = await call('GET', '/a/v1/ontology/object-types');
const tlist = Array.isArray(tl.body) ? tl.body : tl.body?.items || [];
L('published types:', tlist.map((t) => `${t.key}(${t.status})`).join(', '));

// ---- 2. upload + objectify to materialize objects into those types ----
const datasets = {
  SalesOrder: 'orderNo,productCode,qtyGwh,wantDate,buyer,creditRatio\nRO-2001,S192-PACK,500,2026-09-01,北方储能,0.6\nRO-2002,L148-TRUCK,120,2026-10-01,华东物流,0.4',
  ProductModel: 'code,plants\nS192-PACK,常州\nL148-TRUCK,武汉',
  SegmentDemand: 'seg,gm,gmFloor\n储能,8,12\n商用车,18,10',
  MatBalance: 'mat,shortTon,eta\n碳酸锂,30,2026-08-20',
};
for (const [k, csv] of Object.entries(datasets)) {
  const up = await call('POST', '/a/v1/uploads', { filename: `${k}.csv`, contentBase64: b64(csv) });
  const connId = up.body?.connection?.id;
  const obj = await call('POST', '/a/v1/databuilder/intake/objectify', { connId });
  L(`objectify ${k}: ${obj.status} materialized=${JSON.stringify(obj.body?.materialized || obj.body?.error?.message || obj.body)}`);
}
const so = await call('GET', '/a/v1/objects?type=SalesOrder');
const soItems = so.body?.items || so.body?.objects || so.body || [];
L('SalesOrder objects:', Array.isArray(soItems) ? soItems.length : JSON.stringify(soItems).slice(0,120));

// ---- 3. bind (DRAFT) → invoke still canonical reject → activate → invoke true answer ----
const bindingBody = {
  roleBindings: [
    { role: 'order', typeKey: 'SalesOrder', fieldMap: { so: 'orderNo', model: 'productCode', qty: 'qtyGwh', due: 'wantDate', cust: 'buyer', creditUsedRatio: 'creditRatio' } },
    { role: 'model', typeKey: 'ProductModel', fieldMap: { modelId: 'code', bases: 'plants' } },
    { role: 'demandSegment', typeKey: 'SegmentDemand', fieldMap: { segment: 'seg', marginPct: 'gm', floorPct: 'gmFloor' } },
    { role: 'materialBalance', typeKey: 'MatBalance', fieldMap: { material: 'mat', gapTon: 'shortTon', etaDate: 'eta' } },
  ],
};
const created = await call('POST', '/a/v1/solvers/order_fullchain/bindings', bindingBody);
L('create binding:', created.status, 'id=' + (created.body?.id || ''), 'status=' + (created.body?.status || ''));
const bid = created.body?.id;
const invDraft = await call('POST', '/a/v1/solvers/order_fullchain/invoke', { args: {} });
L('invoke (DRAFT binding):', invDraft.status, 'msg/verdict=', invDraft.body?.error?.message || invDraft.body?.data?.verdict);
const act = await call('POST', `/a/v1/solvers/order_fullchain/bindings/${bid}/activate`, {});
L('activate:', act.status, 'status=' + (act.body?.status || act.body?.error?.message || ''));
const invActive = await call('POST', '/a/v1/solvers/order_fullchain/invoke', { args: {} });
const d = invActive.body?.data || invActive.body;
L('invoke (ACTIVE binding):', invActive.status);
L('  ANSWER:', JSON.stringify({ so: d?.so, verdict: d?.verdict, qty: d?.kpis?.qty, segment: d?.kpis?.segment, marginPct: d?.kpis?.marginPct, floorPct: d?.kpis?.floorPct, kitGap: d?.kpis?.kitGap, material: d?.judges?.kit?.material, msg: invActive.body?.error?.message }));
const pass = invActive.status === 200 && d?.so === 'RO-2001' && String(d?.verdict).includes('提价');
L(pass ? 'C2 PASS ✅ — 上传真实数据(RO-2001)配绑定后 order_fullchain 出真答案(提价)·HTTP 全链' : 'C2 partial — see answer above');
