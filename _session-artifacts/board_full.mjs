process.env.SEED_DEMO="1";process.env.JWT_SECRET="dev";process.env.BLOB_DIR="/tmp/blobs-wc";process.env.CREDENTIAL_KEY="a".repeat(64);process.env.LOG_LEVEL="silent";
const D="/home/user/complete/apps/datacore/dist";
const {loadConfig}=await import(`${D}/config.js`);const {createMemoryRepos}=await import(`${D}/repo/memory.js`);
const {LocalFsBlobStore}=await import(`${D}/blob.js`);const {createLlmClient}=await import(`${D}/llm.js`);
const {buildApp}=await import(`${D}/app.js`);const {seedDemo,seedDemoSynthetic,seedDemoSopVersion}=await import(`${D}/seed.js`);
const {liveTightness}=await import(`${D}/solvers/risk.js`);
const config=loadConfig();const repos=createMemoryRepos();const blob=new LocalFsBlobStore(config.BLOB_DIR);const llm=createLlmClient(config);
const logger={info(){},warn(){},error(){},debug(){},fatal(){},trace(){},child(){return logger}};
const {services}=await buildApp({config,repos,blob,llm,logger,bootstrapRequired:false});
const ctx=await seedDemo(repos);await seedDemoSynthetic(services.synthetic,ctx);try{await seedDemoSopVersion(services.sop,services.solvers,ctx)}catch(e){}
const factors=["设备OEE","良率波动","物料齐套","瓶颈工序","人力工时","物流时长","换型损失"];
const TH=85;
for(const feat of [["ON",new Set(["view.risk-board","qos.risk_realdemand"])],["OFF",new Set(["view.risk-board"])]]){
  const c=await services.solvers.loadContext("demo");c.features=feat[1];
  console.log(`\n===== ${feat[0]} : per-base representative (max LIVE tension) =====`);
  let red=0,total=0;
  for(const b of c.bases.map(x=>({id:String(x.props.baseId),name:String(x.props.name)})).sort((a,b)=>a.id<b.id?-1:1)){
    total++;let best=null;
    for(const f of factors){const lt=liveTightness(c,b.id,f);if(lt.live&&lt.value!=null&&lt.source!=="SYNTHETIC"){if(best==null||lt.value>best.v)best={f,v:lt.value,src:lt.source}}}
    const isRed=best&&best.v>=TH;if(isRed)red++;
    console.log(`  ${b.name.padEnd(6)} rep=${best?best.f:'(none)'} tight=${best?best.v:'-'} ${isRed?'>=85 RED':'<85 not-red'}`);
  }
  console.log(`  => ${feat[0]}: ${red}/${total} bases DECISION-RED (LIVE rep >= ${TH})`);
}
console.log("\nDONE_BOARD_FULL");
