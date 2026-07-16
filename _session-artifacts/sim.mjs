function hashString(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}

// params (battery)
const factors=["瓶颈工序","设备OEE","人力工时","物料齐套","物流时长","换型损失","良率波动"];
const primary={常州:"瓶颈工序",厦门:"设备OEE",成都:"设备OEE",眉山:"人力工时",武汉:"良率波动",江门:"物料齐套",合肥:"设备OEE",信阳:"物流时长",枣庄:"换型损失",邯郸:"物料齐套",自贡:"人力工时",洛阳:"良率波动"};
const defaultPrimary="瓶颈工序";
const M={mod:9,factorMult:7,primaryBase:88,primaryCap:97,secondaryBase:55,secondaryCap:83,utilHigh:0.82,utilHighAdd:6,utilLowAdd:2};
const R={threshold:85,cap:98,rampDen:0.72,pulseWindow:3,pulseDecayDen:4,psFloor:0.25,psStart:68,psDen:45,targetLift:{base:8,mod:13},eventAmps:{maint_window:14,delivery_peak:9,arrival_gap:10},arrivalCycleDays:14};

// base names (CJK) -> we need util per base. We don't have exact util values; but PRIMARY-factor mockTightness ignores util.
// SECONDARY-factor mockTightness uses util. For the AUTO-CARD path, only SECONDARY factors are considered, and util matters.
// We'll bound: assume util unknown => secondary uses utilLowAdd(2) if util<=0.82 else utilHighAdd(6). Test both.

function mockTight(bn,factor,util){
  const seed=((bn.charCodeAt(0)||0)+(factor.charCodeAt(0)||0)*M.factorMult)%M.mod;
  if(factor===(primary[bn]??defaultPrimary)) return Math.min(M.primaryCap,M.primaryBase+(seed%M.mod));
  return Math.min(M.secondaryCap,M.secondaryBase+seed+(util>M.utilHigh?M.utilHighAdd:M.utilLowAdd));
}
function riskTarget(bn,factor,cur){const lift=(((bn.charCodeAt(0)||0)+(factor.charCodeAt(0)||0))%R.targetLift.mod)+R.targetLift.base;return Math.min(96,cur+lift);}
// tensionSeries WITHOUT events (events depend on orders/maint; we test the no-event baseline = pure mock climb)
function tensionNoEvent(bn,factor,util,horizon=30){
  const cur=mockTight(bn,factor,util);const tgt=riskTarget(bn,factor,cur);const s=[];
  for(let d=1;d<=horizon;d++){const vb=cur+(tgt-cur)*Math.min(1,d/(R.rampDen*horizon));s.push(Math.min(R.cap,Math.round(vb)));}
  return s;
}
const bases=Object.keys(primary);
console.log("=== AUTO-CARD path: per base, does ANY secondary factor reach a PEAK>=85 on the no-event baseline? ===");
console.log("(riskTimeline skips primary factor; card needs crossDay!=null i.e. some day series>=85)\n");
for(const util of [0.5, 0.9]){
  console.log(`--- assuming util=${util} (${util>0.82?'HIGH +6':'LOW +2'}) ---`);
  for(const bn of bases){
    const prim=primary[bn];
    let redFactors=[];
    let primTight=mockTight(bn,prim,util);
    for(const f of factors){
      if(f===prim) continue;
      // riskTimeline also skips if mockTightness(b,f) >= threshold (line 235): those are excluded from pairs entirely
      const mt=mockTight(bn,f,util);
      if(mt>=R.threshold) continue;
      const series=tensionNoEvent(bn,f,util);
      const peak=Math.max(...series);
      if(peak>=R.threshold) redFactors.push(`${f}(peak=${peak})`);
    }
    console.log(`${bn}: primaryFactor=${prim} primaryMockTight=${primTight}${primTight>=85?' [RED on bottleneck_matrix grid]':''}  autoRedSecondary=[${redFactors.join(', ')||'none w/o events'}]`);
  }
  console.log();
}

// Now order routing: which orders land on luoyang / xinyang (圆柱-LFP)
console.log("=== Order routing for 圆柱-LFP (producible=[xinyang,luoyang] sorted = [luoyang? no, model.bases is SORTED]) ===");
// model.bases = MODEL_BASE_MAP sorted: ["luoyang","xinyang"]? MODEL_BASE_MAP value ["xinyang","luoyang"]; orders use model.bases which were .sort()'d at line 1236
const producible=["luoyang","xinyang"]; // sorted
for(const so of ["SO-3470","SO-3529"]){
  const startIdx=hashString(so)%producible.length;
  const nBases=producible.length>=3?2:1;
  const orderBases=Array.from({length:Math.min(nBases,producible.length)},(_,k)=>producible[(startIdx+k)%producible.length]).sort();
  console.log(`${so}: startIdx=${startIdx} -> bases=[${orderBases.join(',')}]`);
}
console.log("\nluoyang base name CJK char codes:", "洛".charCodeAt(0), "良".charCodeAt(0));
console.log("luoyang primary mockTightness (良率波动):", mockTight("洛阳","良率波动",0.5), "(>=85 =>", mockTight("洛阳","良率波动",0.5)>=85,") -- INDEPENDENT of util/orders");
