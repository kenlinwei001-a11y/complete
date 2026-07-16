import { LlmProviderRegistry, RoutingLlmClient, LlmSettings } from '/home/user/complete/apps/agentcore/dist/llm/providers.js';
import { DataCoreProviderDirectory } from '/home/user/complete/apps/agentcore/dist/llm/datacore-directory.js';
const config = { QOS_DEFAULT_LLM_PROVIDER:'anthropic', QOS_AGENT_MODEL:'claude-opus-4-8', QOS_CLASSIFIER_MODEL:'claude-haiku-4-5', CREDENTIAL_KEY:'0'.repeat(64) };
const repos = { llmBindings:{get:async()=>undefined}, llmProviders:{byKey:async()=>undefined}, credentials:{get:async()=>undefined} };
const directory = new DataCoreProviderDirectory({ baseUrl:'http://127.0.0.1:4001', serviceToken:'devservice' });
const settings = new LlmSettings(repos, config, directory);
const TENANT='demo';
// hammer roleModel + bindingFor 30x quickly (no LLM calls) to detect intermittency
let agentKimi=0, agentDefault=0, bindOk=0, bindNull=0, errs=0;
for (let i=0;i<30;i++){
  try {
    const spec = await settings.roleModel(TENANT,'agent',undefined);
    if (spec.startsWith('dcp:')) agentKimi++; else agentDefault++;
    const b = await directory.bindingFor(TENANT,'agent');
    if (b) bindOk++; else bindNull++;
    if (spec!=='dcp:llmp_r19kt4kr9yb9rzn8:kimi-k2.6') console.log('  iter',i,'spec=',spec);
  } catch(e){ errs++; console.log('  iter',i,'ERR',e?.message); }
}
console.log(`roleModel agent → Kimi:${agentKimi} default:${agentDefault} | bindingFor ok:${bindOk} null:${bindNull} | errs:${errs}`);
