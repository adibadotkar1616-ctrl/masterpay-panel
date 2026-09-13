const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function money(v){ return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(v||0)); }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function msg(text){ $("#authMsg").textContent = text || ""; }

function closeMenu(){
  document.body.classList.remove("menu-open");
  $("#menuToggle")?.setAttribute("aria-expanded","false");
  $("#navOverlay")?.setAttribute("aria-hidden","true");
}
function showView(id){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  closeMenu();
  window.scrollTo({top:0,behavior:"smooth"});
}

$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

$("#menuToggle")?.addEventListener("click",()=>{
  const open=document.body.classList.toggle("menu-open");
  $("#menuToggle").setAttribute("aria-expanded",String(open));
  $("#navOverlay")?.setAttribute("aria-hidden",String(!open));
});
$("#navOverlay")?.addEventListener("click",closeMenu);
document.addEventListener("keydown",e=>{if(e.key==="Escape") closeMenu();});

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
  const bal=money(u.wallet_balance);
  $("#walletBalance").textContent=bal;
  $("#dashBalance").textContent=bal;
  $("#dashBalance2").textContent=bal;
  $("#kycStatus").textContent=u.kyc_status;
  $("#dashKyc").textContent=u.kyc_status;
  $("#kycCard").textContent=u.kyc_status.replaceAll("_"," ");
  $("#dashStatus").textContent=u.status;
  $("#statusDot").textContent=u.status;
  $("#authView").classList.add("hidden");
  $("#panelView").classList.remove("hidden");
  $("#logout").classList.remove("hidden");
  if(u.role==="admin") $("#adminNav").classList.remove("hidden");
}

function renderPaymentSettings(s){
  const set=(id,v)=>{const el=$(id); if(el) el.textContent=v||"—";};
  set("#paymentBankName",s.bank_name);
  set("#paymentAccountHolder",s.account_holder);
  set("#paymentAccountNumber",s.account_number);
  set("#paymentIfsc",s.ifsc_code);
  set("#paymentUpiId",s.upi_id);
  set("#paymentUpiName",s.upi_name);
  set("#paymentQrName",s.upi_name);
  const qr=$("#paymentQr"); if(qr) qr.src=s.qr_image_url||"/assets/upi-qr.jpeg";
  [["#copyAccountNumber",s.account_number],["#copyIfsc",s.ifsc_code],["#copyUpi",s.upi_id]].forEach(([id,v])=>{const el=$(id); if(el) el.dataset.copy=v||"";});
}

async function loadPaymentSettings(){
  try{const d=await api("/api/payment-settings"); renderPaymentSettings(d.settings);}catch(e){console.error(e);}
}

function fillPaymentSettingsForm(s){
  const map={bank_name:"#settingBankName",account_holder:"#settingAccountHolder",account_number:"#settingAccountNumber",ifsc_code:"#settingIfsc",upi_id:"#settingUpiId",upi_name:"#settingUpiName",qr_image_url:"#settingQrUrl"};
  Object.entries(map).forEach(([k,id])=>{const el=$(id);if(el)el.value=s?.[k]||"";});
  const qr=$("#settingQrPreview"); if(qr) qr.src=s?.qr_image_url||"/assets/upi-qr.jpeg";
}

async function loadAdminPaymentSettings(){
  try{const d=await api("/api/admin/payment-settings");fillPaymentSettingsForm(d.settings);}catch(e){$("#paymentSettingsMsg").textContent=e.message;}
}

async function loadData(){
  const me=await api("/api/me"); renderUser(me.user);
  await loadPaymentSettings();
  try{
    const b=await api("/api/banks");
    const banks=b.banks;
    $("#banksList").innerHTML=banks.length?banks.map(x=>`<div class="bank-row"><span class="bank-icon">▣</span><div><b>${escapeHtml(x.bank_name)}</b><small>${escapeHtml(x.account_holder)} · ${escapeHtml(x.account_type || "savings")} · ${escapeHtml(x.ifsc_code || "")} · Account ending ${escapeHtml(x.account_last4)}</small></div><em>${escapeHtml(x.status)}</em><button class="remove-bank" type="button" data-bank-id="${escapeHtml(x.id)}">Remove</button></div>`).join(""):"<div class='empty-state'><span>▣</span><b>No bank accounts</b><small>Add a bank account to prepare for verified withdrawals.</small></div>";
    const select=$("#withdrawBank");
    if(select) select.innerHTML='<option value="">Select a verified bank account</option>'+banks.filter(x=>x.status==='verified').map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.bank_name)} · ••••${escapeHtml(x.account_last4)}</option>`).join("");
    $$(".remove-bank").forEach(btn=>btn.onclick=async()=>{
      if(!confirm("Remove this bank account?")) return;
      try{await api(`/api/banks/${encodeURIComponent(btn.dataset.bankId)}`,{method:"DELETE"});await loadData();}
      catch(e){$("#bankMsg").textContent=e.message;}
    });
  }catch(e){$("#banksList").textContent=e.message}
  try{
    const t=await api("/api/transactions");
    $("#txBody").innerHTML=t.transactions.length?t.transactions.map(x=>`<tr><td>${escapeHtml(x.type)}</td><td>${money(x.amount)}</td><td><span class="tx-status">${escapeHtml(x.status)}</span></td><td>${escapeHtml(new Date(x.created_at).toLocaleString("en-IN"))}</td></tr>`).join(""):`<tr><td colspan="4">No transactions.</td></tr>`;
  }catch(e){$("#txBody").innerHTML=`<tr><td colspan="4">${escapeHtml(e.message)}</td></tr>`}
  if(me.user.role==="admin"){
    await loadAdminPaymentSettings();
    try{
      const a=await api("/api/admin/users");
      $("#usersBody").innerHTML=a.users.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.email)}</td><td>${escapeHtml(x.role)}</td><td>${escapeHtml(x.kyc_status)}</td><td>${escapeHtml(x.status)}</td></tr>`).join("");
    }catch(e){$("#usersBody").innerHTML=`<tr><td colspan="5">${escapeHtml(e.message)}</td></tr>`}
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

function toggleForm(id){
  const el=$(id); if(el) el.classList.toggle("hidden");
}

$("#openDeposit").onclick=()=>{ $("#depositPanel").classList.remove("hidden"); $("#withdrawPanel").classList.add("hidden"); };
$("#openWithdraw").onclick=()=>{ $("#withdrawPanel").classList.remove("hidden"); $("#depositPanel").classList.add("hidden"); };
$("#openBankForm").onclick=()=>$("#bankPanel").classList.remove("hidden");
$("#openBankFromWallet").onclick=()=>{ document.querySelectorAll(".view").forEach(v=>v.classList.remove("active")); $("#banks").classList.add("active"); $("#bankPanel").classList.remove("hidden"); window.scrollTo({top:0,behavior:"smooth"}); };
$("#bindWithdrawalBank")?.addEventListener("click",()=>$("#openBankFromWallet").click());
$$('.close-form').forEach(b=>b.onclick=()=>b.closest('.form-panel')?.classList.add('hidden'));

const depositPlan = $("#depositPlan");
const depositAmount = $("#depositAmount");
function updateDepositAmount(){
  const amount=Number(depositPlan?.value||0);
  if(depositAmount) depositAmount.textContent=money(amount);
}
depositPlan?.addEventListener("change",updateDepositAmount);
updateDepositAmount();

$$(".copy-btn").forEach(btn=>btn.addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(btn.dataset.copy||""); const old=btn.textContent; btn.textContent="Copied"; setTimeout(()=>btn.textContent=old,1200);}
  catch(e){btn.textContent="Copy failed"; setTimeout(()=>btn.textContent="Copy",1200);}
}));

$("#depositForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const body=Object.fromEntries(new FormData(e.target));
  const utr=String(body.utr||"").trim();
  const amount=Number(body.amount);
  if(!Number.isFinite(amount)||amount<=0){$("#walletMsg").textContent="Please select a deposit plan."; return;}
  if(utr.length<6){$("#walletMsg").textContent="Enter a valid UTR / Transaction ID after making the payment."; $("#depositUtr")?.focus(); return;}
  $("#walletMsg").textContent="Submitting deposit for verification…";
  try{const d=await api("/api/deposits",{method:"POST",body:JSON.stringify(body)});$("#walletMsg").textContent=d.message; e.target.reset(); updateDepositAmount(); await loadData();}
  catch(err){$("#walletMsg").textContent=err.message;}
});

$("#withdrawForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault(); $("#walletMsg").textContent="Creating withdrawal request…";
  const body=Object.fromEntries(new FormData(e.target));
  try{const d=await api("/api/withdrawals",{method:"POST",body:JSON.stringify(body)});$("#walletMsg").textContent=d.message; e.target.reset(); await loadData();}
  catch(err){$("#walletMsg").textContent=err.message;}
});

$("#bankForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault(); $("#bankMsg").textContent="Saving bank account…";
  const body=Object.fromEntries(new FormData(e.target));
  body.ifsc_code=String(body.ifsc_code||"").trim().toUpperCase();
  body.account_number=String(body.account_number||"").replace(/\s+/g,"");
  body.mobile_number=String(body.mobile_number||"").replace(/\D/g,"");
  try{await api("/api/banks",{method:"POST",body:JSON.stringify(body)});$("#bankMsg").textContent="Bank account added and marked pending."; e.target.reset(); await loadData();}
  catch(err){$("#bankMsg").textContent=err.message;}
});

$("#paymentSettingsForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const msgEl=$("#paymentSettingsMsg"); msgEl.textContent="Saving payment settings…";
  const body=Object.fromEntries(new FormData(e.target));
  body.account_number=String(body.account_number||"").replace(/\s+/g,"");
  body.ifsc_code=String(body.ifsc_code||"").trim().toUpperCase();
  body.qr_image_url=String(body.qr_image_url||"").trim();
  try{const d=await api("/api/admin/payment-settings",{method:"PUT",body:JSON.stringify(body)});renderPaymentSettings(d.settings);fillPaymentSettingsForm(d.settings);msgEl.textContent=d.message;}catch(err){msgEl.textContent=err.message;}
});
$("#settingQrUrl")?.addEventListener("input",()=>{const v=$("#settingQrUrl").value.trim(); const img=$("#settingQrPreview"); if(img&&v) img.src=v;});

$("#logout").onclick=async()=>{ await api("/api/auth/logout",{method:"POST"}); location.reload(); };

function tick(){ $("#clock").textContent=new Date().toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}); }
tick(); setInterval(tick,1000);
api("/api/me").then(loadData).catch(()=>{});
