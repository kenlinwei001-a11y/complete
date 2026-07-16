const DC="http://127.0.0.1:4001", AC="http://127.0.0.1:4102", PKG="pkg_battery_manufacturing";
async function login(t,u,p){const r=await fetch(`${DC}/a/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:t,username:u,password:p})});return (await r.json()).accessToken;}
const jwt=await login("demo","admin","demo1234");
const sub=await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({packageId:PKG,query:"常州基地的瓶颈根因是什么",context:{view:"dash",selectedObjects:[],filters:{}}})});
const {taskId,streamUrl}=await sub.json();
console.log("taskId:",taskId,"streamUrl:",streamUrl);
const url = streamUrl.startsWith("http")?streamUrl:`${AC}${streamUrl}`;
const res=await fetch(url,{headers:{authorization:`Bearer ${jwt}`,accept:"text/event-stream"}});
const reader=res.body.getReader();const dec=new TextDecoder();let buf="";const t0=Date.now();
let evName=null;
while(Date.now()-t0<12000){
  const {value,done}=await reader.read();if(done)break;
  buf+=dec.decode(value,{stream:true});
  const lines=buf.split("\n");buf=lines.pop();
  for(const ln of lines){
    if(ln.startsWith("event:"))evName=ln.slice(6).trim();
    else if(ln.startsWith("data:")){const data=ln.slice(5).trim();
      if(evName&&/clarif/i.test(evName)){console.log("EVENT:",evName);console.log("DATA:",data.slice(0,600));}
      else if(evName)console.log("event:",evName);
    }
  }
}
reader.cancel();
