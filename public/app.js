const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function money(v){ return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(v||0)); }
function msg(text){ $("#authMsg").textContent = text || ""; }

function showView(id){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  window.scrollTo({top:0,behavior:"smooth"});
}

$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

$("#loginTab").onclick=()=>{ $("#loginTab").classList.add("active");$("#registerTab").classList.remove("active");$("#loginForm").classList.remove("hidden");$("#registerForm").classList.add("hidden");msg(""); };
$("#registerTab").onclick=()=>{ $("#registerTab").classList.add("active");$("#loginTab").classList.remove("active");$("#registerForm").classList.remove("hidden");$("#loginForm").classList.add("hidden");msg(""); };

async function api(url, options={}){
  const r=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.message||"Request failed");
  return data;
}

function renderUser(u){
  $("#welcome").textContent=`Welcome, ${u.name}`;
  $("#pName").textContent=u.name;
  $("#pEmail").textContent=u.email;
  $("#pRole").textContent=u.role;
  $("#pJoined").textContent=new Date(u.created_at).toLocaleDateString("en-IN");
  $("#walletBalance").textContent=money(u.wallet_balance);
  $("#dashBalance").textContent=money(u.wallet_balance);
  $("#kycStatus").textContent=u.kyc_status;
  $("#dashKyc").textContent=u.kyc_status;
  $("#kycCard").textContent=u.kyc_status;
  $("#dashStatus").textContent=u.status;
  $("#authView").classList.add("hidden");
  $("#panelView").classList.remove("hidden");
  $("#logout").classList.remove("hidden");
  if(u.role==="admin") $("#adminNav").classList.remove("hidden");
}

async function loadData(){
  const me=await api("/api/me"); renderUser(me.user);
  try{
    const b=await api("/api/banks");
    $("#banksList").innerHTML=b.banks.length?b.banks.map(x=>`<div class="notice">${x.bank_name} · ****${x.account_last4} · ${x.status}</div>`).join(""):"No bank accounts.";
  }catch(e){$("#banksList").textContent=e.message}
  try{
    const t=await api("/api/transactions");
    $("#txBody").innerHTML=t.transactions.length?t.transactions.map(x=>`<tr><td>${x.type}</td><td>${money(x.amount)}</td><td>${x.status}</td><td>${new Date(x.created_at).toLocaleString("en-IN")}</td></tr>`).join(""):`<tr><td colspan="4">No transactions.</td></tr>`;
  }catch(e){$("#txBody").innerHTML=`<tr><td colspan="4">${e.message}</td></tr>`}
  if(me.user.role==="admin"){
    try{
      const a=await api("/api/admin/users");
      $("#usersBody").innerHTML=a.users.map(x=>`<tr><td>${x.name}</td><td>${x.email}</td><td>${x.role}</td><td>${x.kyc_status}</td><td>${x.status}</td></tr>`).join("");
    }catch(e){$("#usersBody").innerHTML=`<tr><td colspan="5">${e.message}</td></tr>`}
  }
}

$("#loginForm").addEventListener("submit",async(e)=>{
  e.preventDefault(); msg("Signing in…");
  const body=Object.fromEntries(new FormData(e.target));
  try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify(body)});renderUser(d.user);await loadData();}
  catch(err){msg(err.message);}
});

$("#registerForm").addEventListener("submit",async(e)=>{
  e.preventDefault(); msg("Creating account…");
  const body=Object.fromEntries(new FormData(e.target));
  try{const d=await api("/api/auth/register",{method:"POST",body:JSON.stringify(body)});renderUser(d.user);await loadData();}
  catch(err){msg(err.message);}
});

$("#logout").onclick=async()=>{
  await api("/api/auth/logout",{method:"POST"});
  location.reload();
};

function tick(){ $("#clock").textContent=new Date().toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}); }
tick(); setInterval(tick,1000);

api("/api/me").then(loadData).catch(()=>{});
