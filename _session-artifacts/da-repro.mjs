import { makeApp } from '/home/user/complete/apps/datacore/test/helpers.ts';
const ADMIN = { 'x-debug-user': 'demo:admin:admin' };
const t = await makeApp();
// enable feature
await t.app.inject({ method:'PUT', url:'/a/v1/tenants/demo/features', headers:ADMIN, payload:{ overrides:{ 'audit-sink': true } } });
const put = await t.app.inject({ method:'PUT', url:'/a/v1/audit-sinks', headers:ADMIN, payload:{ kind:'webhook_ndjson', endpoint:'http://127.0.0.1:9099/ingest', secret:'top-secret' } });
console.log('PUT status:', put.statusCode);
console.log('PUT body:', put.body.slice(0, 500));
