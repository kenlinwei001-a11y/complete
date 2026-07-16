import { launch, login, watch, newSink, goto, snapshot, BASE } from './lib.mjs';

const TARGETS = [
  ['/admin/agents', 'B1 Agent'],
  ['/admin/workflows', 'B2 Workflow/DAG'],
  ['/admin/mcp', 'B3 MCP'],
  ['/admin/skills', 'B4 Skill'],
  ['/admin/scenes', 'B5 Scenes'],
  ['/admin/data-builder', 'DataBuilder'],
  ['/admin/actions', 'S2 Actions'],
  ['/admin/tickets', 'TicketCenter'],
];

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink();
watch(page, sink);
await login(page, 'admin');
console.log('logged in as admin');

for (const [path, name] of TARGETS) {
  // reset per-page sink slices
  const before = { http: sink.http.length, pe: sink.pageerrors.length, ce: sink.console.length };
  await goto(page, path);
  await page.waitForTimeout(900);
  const snap = await snapshot(page);
  const dir = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots';
  const fn = path.replace(/\//g, '_');
  await page.screenshot({ path: `${dir}${fn}.png`, fullPage: false });
  const httpNew = sink.http.slice(before.http);
  const peNew = sink.pageerrors.slice(before.pe);
  const ceNew = sink.console.slice(before.ce).filter((c) => c.t === 'error');
  console.log(`\n===== ${name} (${path}) =====`);
  console.log('  url now:', await page.evaluate(() => location.pathname));
  console.log('  textLen:', snap.len, '| tables:', snap.tables, '| tbody rows:', snap.rows, '| canvas/svg:', snap.canvas);
  console.log('  empties:', JSON.stringify(snap.empties));
  console.log('  errors:', JSON.stringify(snap.errors));
  console.log('  buttons:', JSON.stringify(snap.buttons));
  console.log('  text[:900]:', snap.text.slice(0, 900));
  if (httpNew.length) console.log('  HTTP>=400:', JSON.stringify(httpNew));
  if (peNew.length) console.log('  PAGEERR:', JSON.stringify(peNew));
  if (ceNew.length) console.log('  CONSOLE.err:', JSON.stringify(ceNew.slice(0, 6)));
}
await ctx.close();
await browser.close();
console.log('\nDONE');
