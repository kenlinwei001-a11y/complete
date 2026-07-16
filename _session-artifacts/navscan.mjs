import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';

const role = process.argv[2] || 'admin';
const creds = role==='planner' ? {username:'planner'} : {username:'admin'};

const VIEWS = ['dash','graph','risk','order','plan-audit','plan-generate','project-sim','sop-balance','review','annual-scenario','quarterly-rolling','order-chain'];
const ADMIN = ['query-history','external-signals','calibration','agents','workflows','skills','scenes','mcp','solvers','solver-review','catalog','views','actions','decisions','rules','modeling','object-types','connections','synthetic','knowledge','tickets','ops-schedule','evals'];

const { browser, page, logs } = await launch();
const ok = await login(page, creds);
console.log(`LOGIN ${role}: ${ok ? 'OK' : 'FAIL'} url=${page.url()}`);
if (!ok) { console.log('body:', (await pageState(page)).sample); await browser.close(); process.exit(1); }

async function visit(kind, key){
  const url = kind==='view' ? `${BASE}/v/${key}` : `${BASE}/admin/${key}`;
  clearLogs(logs);
  let navErr='';
  try { await page.goto(url, { waitUntil:'domcontentloaded', timeout:20000 }); }
  catch(e){ navErr = 'NAV_TIMEOUT'; }
  await page.waitForTimeout(1800);
  const st = await pageState(page);
  const btns = await page.$$eval('button, [role=button], a[href^="/"]', els => els.filter(e=>e.offsetParent!==null).length);
  const s = snapLogs(logs);
  const flags=[];
  if (navErr) flags.push(navErr);
  if (st.textLen < 40) flags.push('BLANK/WHITE');
  if (st.errBoundary) flags.push('ERROR_BOUNDARY');
  if (s.pageerr.length) flags.push('PAGEERR('+s.pageerr.length+')');
  if (s.net4xx5xx.length) flags.push('HTTP_ERR('+s.net4xx5xx.length+')');
  const status = flags.length ? flags.join(',') : 'OK';
  await page.screenshot({ path:`${SHOT_DIR}/${role}-${kind}-${key}.png` }).catch(()=>{});
  console.log(`[${kind}/${key}] ${status} | textLen=${st.textLen} btns=${btns}`);
  if (s.net4xx5xx.length) console.log('   HTTP:', [...new Set(s.net4xx5xx)].slice(0,6).join(' ; '));
  if (s.pageerr.length) console.log('   PAGEERR:', s.pageerr.slice(0,2).join(' | '));
  if (st.textLen < 120) console.log('   SAMPLE:', st.sample);
}

console.log('\n===== VIEWS =====');
for (const v of VIEWS) await visit('view', v);
console.log('\n===== ADMIN =====');
for (const a of ADMIN) await visit('admin', a);

await browser.close();
console.log('\nDONE '+role);
