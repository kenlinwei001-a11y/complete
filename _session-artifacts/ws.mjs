import { readFileSync } from 'fs';
const SP='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
for (const u of ['admin','planner','base_manager']) {
  const tok = readFileSync(`${SP}/tok_${u}.txt`,'utf8').trim();
  const r = await fetch('http://127.0.0.1:4085/a/v1/me/workspace',{headers:{authorization:`Bearer ${tok}`}});
  const w = await r.json();
  const nav = w.nav||w.navigation||w.navGroups||[];
  console.log(`\n===== ${u} (http ${r.status}) =====`);
  console.log('roles:', JSON.stringify(w.user?.roles));
  console.log('theme:', JSON.stringify(w.theme));
  console.log('views:', JSON.stringify((w.views||[]).map(v=>v.key)));
  console.log('features:', JSON.stringify(w.features));
  console.log('nav keys:', JSON.stringify(nav));
  console.log('top-level keys:', Object.keys(w).join(','));
}
