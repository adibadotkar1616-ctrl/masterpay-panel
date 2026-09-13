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
  $("#pUserId").textContent=u.public_user_id||"—";
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

async function loadAdminDeposits(){
  const body=$("#adminDepositsBody");
  const msgEl=$("#adminDepositMsg");
  if(!body) return;
  try{
    const d=await api("/api/admin/deposits");
    body.innerHTML=d.deposits.length ? d.deposits.map(x=>`<tr><td><b>${escapeHtml(x.user_name)}</b><small>${escapeHtml(x.user_email)}</small></td><td>${money(x.amount)}</td><td>${escapeHtml(x.utr||'—')}</td><td>${escapeHtml(new Date(x.created_at).toLocaleString("en-IN"))}</td><td><button class="primary admin-confirm-deposit" type="button" data-deposit-id="${escapeHtml(x.id)}">Confirm Deposit</button></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty-state"><b>No pending deposits</b><small>Confirmed deposits will start their demo transaction stream.</small></div></td></tr>`;
    $$(".admin-confirm-deposit").forEach(btn=>btn.onclick=async()=>{
      if(!confirm("Confirm this deposit and start the user's demo transaction stream?")) return;
      btn.disabled=true;
      if(msgEl) msgEl.textContent="Confirming deposit…";
      try{
        const r=await api(`/api/admin/deposits/${encodeURIComponent(btn.dataset.depositId)}/confirm`,{method:"POST",body:JSON.stringify({})});
        if(msgEl) msgEl.textContent=r.message;
        await loadAdminDeposits();
      }catch(e){
        btn.disabled=false;
        if(msgEl) msgEl.textContent=e.message;
      }
    });
  }catch(e){
    body.innerHTML=`<tr><td colspan="5">${escapeHtml(e.message)}</td></tr>`;
  }
}

function demoType(x){
  if(String(x.reference||'').startsWith('SIM-DEMO-')) return x.type==='deposit'?'CREDIT':'DEBIT';
  return x.type;
}

function demoCommission(x){
  return String(x.reference||'').startsWith('SIM-DEMO-') && x.type==='deposit' ? Number(x.amount||0)*0.07 : 0;
}

let demoToastQueue=[];
let demoToastTimer=null;
let lastNotificationIds=new Set();

function showDemoToast(n){
  const toast=$("#demoToast"); if(!toast) return;
  const isCredit=String(n.title||'').includes('CREDIT');
  $("#demoToastIcon").textContent=isCredit?'+':'−';
  $("#demoToastTitle").textContent=n.title||'TRANSACTION ALERT';
  const match=String(n.body||'').match(/(credited|debited) (₹[0-9,]+\.\d{2})/i);
  $("#demoToastAmount").textContent=match?.[2]||'Demo activity';
  $("#demoToastBody").textContent='Transaction received';
  toast.classList.remove('hidden');
  clearTimeout(demoToastTimer);
  demoToastTimer=setTimeout(()=>toast.classList.add('hidden'),5500);
}

function queueDemoNotifications(notifications, force=false){
  const fresh=notifications.filter(n=>/^(CREDIT|DEBIT) ALERT$/.test(String(n.title||'')) && (force || !lastNotificationIds.has(n.id)));
  fresh.slice().reverse().forEach(n=>demoToastQueue.push(n));
  lastNotificationIds=new Set(notifications.map(n=>n.id));
  if(!$("#demoToast")?.classList.contains('hidden')) return;
  const next=demoToastQueue.shift(); if(next) showDemoToast(next);
}

async function loadDemoCommission(){
  try{
    const d=await api('/api/commission-summary');
    const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
    set('#demoCount',d.count);
    set('#txTotalCount',d.count);
    set('#walletDemoCount',d.count);
    set('#demoCredits',money(d.credits)); set('#demoCreditsWallet',money(d.credits));
    set('#demoDebits',money(d.debits)); set('#demoDebitsWallet',money(d.debits));
    set('#demoVolume',money(d.volume)); set('#demoCommission',money(d.commission));
    set('#demoDashboardCommission',money(d.commission)); set('#demoRate',`${Number(d.rate*100).toFixed(0)}%`);
  }catch(e){console.error(e);}
}

async function loadNotifications(showToast=true){
  try{
    const d=await api('/api/notifications');
    const list=$("#notificationList");
    if(list) list.innerHTML=d.notifications.length ? d.notifications.map(n=>`<div class="notification-row ${n.is_read?'read':''}"><span class="notification-icon ${String(n.title||'').includes('DEBIT')?'debit':''}">${String(n.title||'').includes('CREDIT')?'+':'!'}</span><div><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.body)}</p><small>${escapeHtml(new Date(n.created_at).toLocaleString('en-IN'))}</small></div></div>`).join('') : `<div class="empty-state"><span>◉</span><b>No notifications</b><small>Your demo alerts will appear here.</small></div>`;
    if(showToast) queueDemoNotifications(d.notifications);
    const unread=d.notifications.filter(n=>!n.is_read).length;
    $$('.nav-btn').filter(b=>b.dataset.view==='notifications').forEach(b=>{b.dataset.unread=unread?String(unread):'';});
  }catch(e){console.error(e);}
}

async function loadKyc(){
  const msgEl=$("#kycMsg");
  try{
    const d=await api("/api/kyc");
    const k=d.kyc||{};
    $("#kycStatus").textContent=k.status||"not_submitted";
  }catch(e){ if(msgEl) msgEl.textContent=e.message; }
}

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(!file) return reject(new Error("Please select all three KYC documents."));
    if(file.size>4*1024*1024) return reject(new Error(`${file.name} is larger than 4 MB.`));
    const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
    if(!allowed.includes(file.type)) return reject(new Error(`${file.name}: use JPG, PNG, WebP or PDF.`));
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

$("#kycForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const msgEl=$("#kycMsg");
  msgEl.textContent="Preparing KYC documents…";
  try{
    const front=await fileToDataUrl($("#aadhaarFront")?.files?.[0]);
    const back=await fileToDataUrl($("#aadhaarBack")?.files?.[0]);
    const pan=await fileToDataUrl($("#panCard")?.files?.[0]);
    msgEl.textContent="Submitting KYC for admin review…";
    const d=await api("/api/kyc",{method:"POST",body:JSON.stringify({aadhaar_front:front,aadhaar_back:back,pan})});
    msgEl.textContent=d.message;
    e.target.reset();
    await loadKyc();
    await loadData();
  }catch(err){ msgEl.textContent=err.message; }
});

function renderAdminKycFile(targetId,dataUrl,label){
  const el=$(targetId); if(!el) return;
  if(!dataUrl){ el.innerHTML=`<div class="empty-state"><b>${label} not uploaded</b></div>`; return; }
  const isPdf=String(dataUrl).startsWith("data:application/pdf");
  el.innerHTML=isPdf ? `<a class="kyc-file-link" href="${dataUrl}" target="_blank" rel="noopener">Open ${label} PDF</a>` : `<a href="${dataUrl}" target="_blank" rel="noopener"><img class="kyc-preview" src="${dataUrl}" alt="${escapeHtml(label)}"/></a>`;
}

let currentAdminKycUserId="";
async function loadAdminKyc(){
  const body=$("#usersBody"); if(!body) return;
  try{
    const d=await api("/api/admin/kyc");
    body.innerHTML=d.users.map(x=>{
      const docs=[x.aadhaar_front_uploaded?"Front":"",x.aadhaar_back_uploaded?"Back":"",x.pan_uploaded?"PAN":""].filter(Boolean).join(" + ")||"None";
      const status=x.document_status||x.kyc_status||"not submitted";
      return `<tr><td><b>${escapeHtml(x.public_user_id||"—")}</b></td><td><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.email)}</small></td><td>${escapeHtml(status)}</td><td>${escapeHtml(docs)}</td><td><button class="primary admin-view-kyc" type="button" data-user-id="${escapeHtml(x.id)}">View KYC</button></td></tr>`;
    }).join("")||`<tr><td colspan="5">No users found.</td></tr>`;
    $$(".admin-view-kyc").forEach(btn=>btn.onclick=()=>viewAdminKyc(btn.dataset.userId));
  }catch(e){ body.innerHTML=`<tr><td colspan="5">${escapeHtml(e.message)}</td></tr>`; }
}

async function viewAdminKyc(userId){
  const viewer=$("#adminKycViewer");
  const msgEl=$("#adminKycMsg");
  currentAdminKycUserId=userId;
  try{
    const d=await api(`/api/admin/kyc/${encodeURIComponent(userId)}`);
    $("#adminKycViewerTitle").textContent=`${d.user.public_user_id||"—"} · ${d.user.name}`;
    $("#adminKycViewerMeta").textContent=`${d.user.email} · KYC status: ${d.kyc?.status||d.user.kyc_status||"not submitted"}`;
    renderAdminKycFile("#adminAadhaarFront",d.kyc?.aadhaar_front,"Aadhaar Front");
    renderAdminKycFile("#adminAadhaarBack",d.kyc?.aadhaar_back,"Aadhaar Back");
    renderAdminKycFile("#adminPan",d.kyc?.pan,"PAN");
    viewer?.classList.remove("hidden");
    viewer?.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){ if(msgEl) msgEl.textContent=e.message; }
}

$("#closeAdminKyc")?.addEventListener("click",()=>$("#adminKycViewer")?.classList.add("hidden"));
async function setAdminKycStatus(status){
  if(!currentAdminKycUserId) return;
  const msgEl=$("#adminKycMsg");
  try{ const d=await api(`/api/admin/kyc/${encodeURIComponent(currentAdminKycUserId)}/status`,{method:"POST",body:JSON.stringify({status})}); if(msgEl) msgEl.textContent=d.message; await loadAdminKyc(); await viewAdminKyc(currentAdminKycUserId); }
  catch(e){ if(msgEl) msgEl.textContent=e.message; }
}
$("#approveKyc")?.addEventListener("click",()=>setAdminKycStatus("approved"));
$("#rejectKyc")?.addEventListener("click",()=>setAdminKycStatus("rejected"));

async function loadData(){
  const me=await api("/api/me"); renderUser(me.user);
  await loadKyc();
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
    $("#txBody").innerHTML=t.transactions.length?t.transactions.map(x=>{
      const isDemo=String(x.reference||'').startsWith('SIM-DEMO-');
      const credit=x.type==='deposit';
      const name=isDemo ? (credit?'Account Credit':'Account Debit') : x.type;
      return `<tr class="${isDemo?'demo-row':''}"><td><div class="tx-name"><span class="tx-avatar ${credit?'credit':'debit'}">${credit?'+':'−'}</span><span><b>${escapeHtml(demoType(x))}</b><small>${escapeHtml(name)}</small></span></div></td><td class="${credit?'amount-credit':'amount-debit'}">${credit?'+':'−'}${money(x.amount)}</td><td>${isDemo?money(demoCommission(x)):'—'}</td><td><span class="tx-status">${escapeHtml(x.status)}</span></td><td>${escapeHtml(new Date(x.created_at).toLocaleString("en-IN"))}</td></tr>`;
    }).join(""):`<tr><td colspan="5">No transactions.</td></tr>`;
  }catch(e){$("#txBody").innerHTML=`<tr><td colspan="4">${escapeHtml(e.message)}</td></tr>`}
  await loadDemoCommission();
  await loadNotifications();
  if(me.user.role==="admin"){
    await loadAdminPaymentSettings();
    await loadAdminDeposits();
    await loadAdminKyc();
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
  if(!Number.isFinite(amount)||amount<=0){$("#securityDepositMsg").textContent="Please select a security deposit plan."; return;}
  if(utr.length<6){$("#securityDepositMsg").textContent="Enter a valid UTR / Transaction ID after making the payment."; $("#depositUtr")?.focus(); return;}
  $("#securityDepositMsg").textContent="Submitting security deposit for verification…";
  try{const d=await api("/api/deposits",{method:"POST",body:JSON.stringify(body)});$("#securityDepositMsg").textContent=d.message; e.target.reset(); updateDepositAmount(); await loadData();}
  catch(err){$("#securityDepositMsg").textContent=err.message;}
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


$("#demoToastClose")?.addEventListener('click',()=>{ $("#demoToast").classList.add('hidden'); clearTimeout(demoToastTimer); const next=demoToastQueue.shift(); if(next) setTimeout(()=>showDemoToast(next),250); });

$("#markNotificationsRead")?.addEventListener('click',async()=>{
  try{await api('/api/notifications/read-all',{method:'POST'}); await loadNotifications();}catch(e){console.error(e);}
});

let demoPollingBusy=false;
async function refreshDemoUi(){
  if(demoPollingBusy) return;
  demoPollingBusy=true;
  try{
    // The server enforces a random 15–25 second gap between demo entries.
    // Polling only checks whether the next entry is due; it cannot bypass the gap.
    await api("/api/demo/tick",{method:"POST",body:JSON.stringify({})});
    const me=await api("/api/me");
    renderUser(me.user);
    await loadDemoCommission();
    await loadNotifications(true);
    const t=await api("/api/transactions");
    const body=$("#txBody");
    if(body) body.innerHTML=t.transactions.length?t.transactions.map(x=>{
      const isDemo=String(x.reference||'').startsWith('SIM-DEMO-');
      const credit=x.type==='deposit';
      const name=isDemo ? (credit?'Account Credit':'Account Debit') : x.type;
      return `<tr class="${isDemo?'demo-row':''}"><td><div class="tx-name"><span class="tx-avatar ${credit?'credit':'debit'}">${credit?'+':'−'}</span><span><b>${escapeHtml(demoType(x))}</b><small>${escapeHtml(name)}</small></span></div></td><td class="${credit?'amount-credit':'amount-debit'}">${credit?'+':'−'}${money(x.amount)}</td><td>${isDemo?money(demoCommission(x)):'—'}</td><td><span class="tx-status">${escapeHtml(x.status)}</span></td><td>${escapeHtml(new Date(x.created_at).toLocaleString("en-IN"))}</td></tr>`;
    }).join(""):`<tr><td colspan="5">No transactions.</td></tr>`;
  }catch(e){ console.error('Demo refresh failed:',e); }
  finally{ demoPollingBusy=false; }
}


$("#refreshAdminDeposits")?.addEventListener("click",loadAdminDeposits);
$("#refreshAdminKyc")?.addEventListener("click",loadAdminKyc);

$("#logout").onclick=async()=>{ await api("/api/auth/logout",{method:"POST"}); location.reload(); };

function tick(){ $("#clock").textContent=new Date().toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}); }
tick(); setInterval(tick,1000);
api("/api/me").then(async()=>{ await loadData(); await refreshDemoUi(); setInterval(refreshDemoUi,2000); }).catch(()=>{});
