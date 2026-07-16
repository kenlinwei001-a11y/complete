import { LlmProviderRegistry, RoutingLlmClient, LlmSettings } from '/home/user/complete/apps/agentcore/dist/llm/providers.js';
import { DataCoreProviderDirectory } from '/home/user/complete/apps/agentcore/dist/llm/datacore-directory.js';

const config = {
  QOS_DEFAULT_LLM_PROVIDER: process.env.QOS_DEFAULT_LLM_PROVIDER ?? 'anthropic',
  QOS_AGENT_MODEL: process.env.QOS_AGENT_MODEL ?? 'claude-opus-4-8',
  QOS_CLASSIFIER_MODEL: process.env.QOS_CLASSIFIER_MODEL ?? 'claude-haiku-4-5',
  CREDENTIAL_KEY: process.env.CREDENTIAL_KEY ?? '0'.repeat(64),
};
const DATACORE = process.env.DATACORE_BASE_URL ?? 'http://127.0.0.1:4001';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN ?? 'devservice';

const repos = {
  llmBindings: { get: async () => undefined },
  llmProviders: { byKey: async () => undefined },
  credentials: { get: async () => undefined },
};

const directory = new DataCoreProviderDirectory({ baseUrl: DATACORE, serviceToken: SERVICE_TOKEN });
const registry = new LlmProviderRegistry({ repos, config, directory });
const settings = new LlmSettings(repos, config, directory);
const llm = new RoutingLlmClient(registry);
const TENANT = 'demo';

async function main() {
  const agentSpec = await settings.roleModel(TENANT, 'agent', undefined);
  const classSpec = await settings.roleModel(TENANT, 'classifier', undefined);
  console.log('roleModel agent      =', agentSpec);
  console.log('roleModel classifier =', classSpec);
  try {
    const b = await directory.bindingFor(TENANT, 'agent');
    console.log('directory.bindingFor(agent) =', JSON.stringify(b));
  } catch (e) { console.log('bindingFor agent THREW:', e?.message); }
  try {
    const r = await registry.resolve(agentSpec, TENANT);
    console.log('resolve(agentSpec) client ctor =', r.client?.constructor?.name, 'model=', r.model, 'providerKey=', r.providerKey);
  } catch (e) { console.log('resolve(agentSpec) THREW:', e?.message); }

  const t0 = Date.now();
  try {
    const resp = await llm.agent({
      model: agentSpec,
      tenantId: TENANT,
      system: 'you are a test. Reply with the single word OK.',
      tools: [],
      messages: [{ role: 'user', content: 'say OK' }],
      maxTokens: 16,
    });
    console.log('llm.agent() OK in ' + (Date.now()-t0) + 'ms; stopReason=' + resp?.stopReason + '; usage=' + JSON.stringify(resp?.usage));
    const txt = (resp?.content ?? []).filter(b=>b.type==='text').map(b=>b.text).join('');
    console.log('  text:', JSON.stringify(txt).slice(0,120));
  } catch (e) {
    console.log('llm.agent() THREW in ' + (Date.now()-t0) + 'ms:', e?.message);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
