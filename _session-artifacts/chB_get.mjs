let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  let j; try{ j=JSON.parse(s);}catch(e){ console.log("RAW:",s.slice(0,300)); return; }
  const path=process.argv[2];
  if(!path){ console.log(JSON.stringify(j)); return; }
  const val=path.split(".").reduce((o,k)=>o==null?o:o[k], j);
  console.log(typeof val==="object"?JSON.stringify(val):String(val));
});
