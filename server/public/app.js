
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('en-KE'):'—';
const state={page:'dashboard',user:null,cache:{}};
const pages=[
  ['LIMS','dashboard','LIMS Dashboard'],['LIMS','samples','Samples'],['LIMS','worklist','Analytical Worklist'],['LIMS','points','Sampling Points'],['LIMS','methods','Tests & Methods'],['LIMS','specs','Specifications'],
  ['SECURITY','security','Security & Users'],
  ['LEGACY','chemicals','Chemical Inventory'],['LEGACY','batches','Batches'],['LEGACY','reagents','Reagent Preparation'],['LEGACY','consumption','Consumption'],['LEGACY','equipment','Equipment'],['LEGACY','calibrations','Calibrations'],['LEGACY','suppliers','Suppliers'],['LEGACY','procurement','Procurement'],['LEGACY','water','Water Treatment'],['LEGACY','waste','Waste'],['LEGACY','sds','SDS / MSDS'],['LEGACY','audit','Audit Trail'],['LEGACY','settings','Settings']
];
const canSetup=()=>['Administrator','Laboratory Manager'].includes(state.user?.role);
const canReview=()=>['Administrator','Laboratory Manager'].includes(state.user?.role);
const canApprove=()=>['Administrator','Laboratory Manager'].includes(state.user?.role);
const canUsers=()=>state.user?.role==='Administrator';
function toast(msg,ok=false){const x=$('subtitle');x.textContent=msg;x.className=ok?'success':'error';setTimeout(()=>{x.textContent='';x.className='muted'},4500)}
async function boot(){try{const x=await EWASCO_API.me();state.user=x.user;showApp();await go('dashboard')}catch{}}
function showApp(){$('login').classList.add('hidden');$('app').classList.remove('hidden');$('identity').textContent=state.user.name+' · '+state.user.role;renderNav()}
function renderNav(){
 const allowed=pages.filter(p=>{
   if(p[1]==='security')return state.user.role==='Administrator'||state.user.role==='Laboratory Manager'||state.user.role==='Analyst/Chemist';
   if(['points','methods','specs'].includes(p[1]))return state.user.role!=='Storekeeper';
   if(['dashboard','samples','worklist'].includes(p[1]))return state.user.role!=='Storekeeper';
   if(p[0]==='LEGACY')return true;
   return true;
 });
 let last='';$('nav').innerHTML=allowed.map(p=>{const sec=p[0]!==last?(last=p[0],'<div class="section">'+esc(p[0])+'</div>'):'';return sec+`<button class="btn ${p[1]===state.page?'active':''}" data-page="${p[1]}">${esc(p[2])}</button>`}).join('');
 $('nav').querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
}
async function go(page){state.page=page;renderNav();$('title').textContent=pages.find(x=>x[1]===page)?.[2]||page;$('content').innerHTML='<div class="empty">Loading…</div>';try{
 if(page==='dashboard')return renderDashboard();if(page==='samples')return renderSamples();if(page==='worklist')return renderWorklist();if(page==='points')return renderPoints();if(page==='methods')return renderMethods();if(page==='specs')return renderSpecs();if(page==='security')return renderSecurity();if(page==='settings')return renderSettings();return renderLegacy(page);
}catch(e){$('content').innerHTML='<div class="error">'+esc(e.message)+'</div>'}}
$('refresh').onclick=()=>go(state.page);

async function renderDashboard(){
 const d=await EWASCO_API.limsDashboard();
 const sampleCounts=Object.fromEntries(d.samples.map(x=>[x.status,x.count]));const testCounts=Object.fromEntries(d.tests.map(x=>[x.status,x.count]));const results=d.results.reduce((a,x)=>{a.count+=x.count;a.failed+=x.failed;return a},{count:0,failed:0});
 $('content').innerHTML=`
 <div class="kpis">
  <div class="kpi"><div class="n">${sampleCounts.REGISTERED||0}</div><div class="l">Registered samples</div></div>
  <div class="kpi"><div class="n">${(testCounts.PLANNED||0)+(testCounts.ASSIGNED||0)}</div><div class="l">Tests waiting assignment</div></div>
  <div class="kpi"><div class="n">${testCounts.RESULT_ENTERED||0}</div><div class="l">Results awaiting review</div></div>
  <div class="kpi"><div class="n">${results.failed||0}</div><div class="l">Specification failures</div></div>
 </div>
 <div class="split section-card">
  <section class="card"><h3>Controlled workflow</h3><p class="note">Register → receive → analyse → review → approve → report → archive. Approved results are locked and remain traceable through the audit trail.</p><div class="inline"><span class="badge">PostgreSQL</span><span class="badge">RBAC</span><span class="badge">CSRF</span><span class="badge">Re-auth approval</span><span class="badge">Separation of duties</span></div></section>
  <section class="card"><h3>Design reference</h3><p class="note">The core follows capabilities documented by leading LIMS platforms: sample traceability, sampling-point management, controlled results entry, review/approval, auditability and water-laboratory workflow. Exact regulatory limits and methods are configuration data, not hard-coded assumptions.</p></section>
 </div>
 <div class="card section-card"><h3>Current LIMS status</h3><div class="table-wrap"><table class="table"><thead><tr><th>Stage</th><th>Count</th></tr></thead><tbody>${d.samples.map(x=>'<tr><td>'+esc(x.status)+'</td><td>'+x.count+'</td></tr>').join('')||'<tr><td colspan="2">No samples yet.</td></tr>'}</tbody></table></div></div>`;
}
async function ensureLookups(){if(!state.cache.points)state.cache.points=await EWASCO_API.samplingPoints();if(!state.cache.methods)state.cache.methods=await EWASCO_API.limsMethods();if(!state.cache.specs)state.cache.specs=await EWASCO_API.limsSpecifications()}
function isoFromInput(v){return v?new Date(v).toISOString():null}
async function renderSamples(){
 const rows=await EWASCO_API.limsSamples();state.cache.samples=rows;
 $('content').innerHTML=`
 <div class="toolbar"><button class="btn primary" id="newSample" ${state.user.role==='Storekeeper'?'disabled':''}>Register sample</button><select id="sampleFilter" class="input" style="max-width:220px"><option value="">All statuses</option>${['REGISTERED','RECEIVED','IN_ANALYSIS','PENDING_REVIEW','APPROVED','REPORTED','ARCHIVED','CANCELLED'].map(s=>'<option>'+s+'</option>').join('')}</select><button class="btn" id="sampleReload">Refresh</button></div>
 <div id="sampleTable"></div>`;
 const draw=rows2=>{const body=rows2.map(r=>`<tr class="clickable" data-sample="${r.id}"><td><b>${esc(r.sample_no)}</b></td><td>${esc(r.sample_type)}</td><td>${esc(r.sampling_point_name||'—')}</td><td><span class="badge">${esc(r.status)}</span></td><td>${r.approved_test_count}/${r.test_count}</td><td>${fmt(r.received_at)}</td></tr>`).join('');$('sampleTable').innerHTML='<div class="table-wrap"><table class="table"><thead><tr><th>Sample</th><th>Type</th><th>Sampling point</th><th>Status</th><th>Approved tests</th><th>Received</th></tr></thead><tbody>'+ (body||'<tr><td colspan="6" class="empty">No samples registered.</td></tr>')+'</tbody></table></div>';document.querySelectorAll('[data-sample]').forEach(x=>x.onclick=()=>showSample(x.dataset.sample))};
 $('sampleFilter').onchange=()=>draw(rows.filter(r=>!$('sampleFilter').value||r.status===$('sampleFilter').value));$('sampleReload').onclick=()=>renderSamples();draw(rows);$('newSample').onclick=()=>openSampleForm();
}
async function openSampleForm(){
 await ensureLookups();
 const html=`
 <div class="overlay" id="modal"><div class="card modal">
  <div class="bar"><h3>Register analytical sample</h3><span class="spacer"></span><button class="btn ghost" id="close">Close</button></div>
  <div class="form-grid">
   <label>Sample type<input id="f_type" class="input" placeholder="e.g. Routine water sample" required></label>
   <label>Matrix<input id="f_matrix" class="input" placeholder="e.g. Drinking water"></label>
   <label>Sampling point<select id="f_point" class="input"><option value="">Unspecified</option>${state.cache.points.filter(p=>p.active).map(p=>'<option value="'+p.id+'">'+esc(p.code)+' — '+esc(p.name)+'</option>').join('')}</select></label>
   <label>Collected at<input id="f_collected" class="input" type="datetime-local"></label>
   <label class="span2">Notes<textarea id="f_notes" class="input" placeholder="Collection/receipt notes"></textarea></label>
   <div class="span2"><div class="muted" style="margin-bottom:6px">Tests to assign <span class="badge">at least one</span></div><div class="checklist">${state.cache.methods.filter(m=>m.active).map(m=>'<label class="check"><input type="checkbox" value="'+m.id+'" data-method> <span><b>'+esc(m.code)+' — '+esc(m.name)+'</b><br><span class="note">'+esc(m.analyte)+' · '+esc(m.result_type)+' · '+esc(m.default_unit||'no default unit')+'</span></span></label>').join('')||'<div class="empty">No active test methods have been configured.</div>'}</div></div>
  </div>
  <p id="fm_err" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="saveSample">Register sample</button></div>
 </div></div>`;
 $('content').insertAdjacentHTML('beforeend',html);$('close').onclick=()=>$('modal').remove();$('saveSample').onclick=async()=>{
   try{const tests=[...document.querySelectorAll('[data-method]:checked')].map(x=>({methodId:x.value,priority:100}));if(!tests.length)throw Error('Select at least one test method');const payload={sampleType:$('f_type').value.trim(),matrix:$('f_matrix').value.trim()||null,samplingPointId:$('f_point').value||null,collectedAt:isoFromInput($('f_collected').value),notes:$('f_notes').value.trim()||null,tests};if(!payload.sampleType)throw Error('Sample type is required');const r=await EWASCO_API.createLimsSample(payload);$('modal').remove();toast('Sample '+r.sample_no+' registered',true);await renderSamples()}catch(e){$('fm_err').textContent=e.message}
 };
}
async function showSample(id){
 const s=await EWASCO_API.limsSample(id);
 const testRows=s.tests.map(t=>{const val=t.value_numeric??t.value_text??'—';let actions='';if(!t.result_id&&!['APPROVED','CANCELLED'].includes(s.status)&&state.user.role!=='Storekeeper')actions+='<button class="btn" data-claim="'+t.id+'">Claim / enter</button> ';if(t.result_id&&t.result_status==='ENTERED'&&canReview())actions+='<button class="btn" data-review="'+t.result_id+'">Review</button> ';if(t.result_id&&t.result_status==='REVIEWED'&&canApprove())actions+='<button class="btn primary" data-approve="'+t.result_id+'">Approve</button>';return '<tr><td><b>'+esc(t.method_code)+'</b><br><span class="note">'+esc(t.method_name)+'</span></td><td><span class="badge">'+esc(t.status)+'</span></td><td>'+esc(val)+(t.unit?' '+esc(t.unit):'')+'</td><td><span class="badge '+(t.result_flag==='FAIL'?'bad':t.result_flag==='PASS'?'good':'')+'">'+esc(t.result_flag||'—')+'</span></td><td>'+esc(t.entered_by||'—')+'</td><td>'+actions+'</td></tr>'}).join('');
 $('content').innerHTML='<div class="bar"><button class="btn" id="back">← Samples</button><span class="spacer"></span><span class="badge">'+esc(s.status)+'</span></div>'+
 '<div class="split"><section class="card"><h3>'+esc(s.sample_no)+'</h3><div class="note">'+esc(s.sample_type)+' · '+esc(s.matrix||'Matrix not recorded')+'</div><div class="note" style="margin-top:8px">Point: '+esc(s.sampling_point_name||'Not specified')+' · Collected: '+fmt(s.collected_at)+' · Received: '+fmt(s.received_at)+'</div></section>'+
 '<section class="card"><h3>Lifecycle</h3><div class="inline"><button class="btn" id="receive" '+(s.status==='REGISTERED'?'':'disabled')+'>Mark received</button><button class="btn" id="cancel" '+(['REGISTERED','RECEIVED','IN_ANALYSIS','PENDING_REVIEW'].includes(s.status)?'':'disabled')+'>Cancel sample</button></div><p class="note">Approvals are server controlled; UI state does not override workflow permissions.</p></section></div>'+
 '<section class="card section-card"><h3>Assigned tests & results</h3><div class="table-wrap"><table class="table"><thead><tr><th>Method</th><th>Status</th><th>Result</th><th>Flag</th><th>Author</th><th>Actions</th></tr></thead><tbody>'+testRows+'</tbody></table></div></section>';
 $('back').onclick=()=>renderSamples();
 $('receive').onclick=async()=>{try{await EWASCO_API.updateLimsSampleStatus(id,'RECEIVED');await showSample(id)}catch(e){alert(e.message)}};
 $('cancel').onclick=async()=>{if(!confirm('Cancel this sample?'))return;try{await EWASCO_API.updateLimsSampleStatus(id,'CANCELLED');await showSample(id)}catch(e){alert(e.message)}};
 document.querySelectorAll('[data-claim]').forEach(b=>b.onclick=()=>enterResult(b.dataset.claim,s));
 document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{try{await EWASCO_API.reviewLimsResult(b.dataset.review);await showSample(id)}catch(e){alert(e.message)}});
 document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{const p=prompt('Re-enter your password to approve this result:');if(p===null)return;try{await EWASCO_API.approveLimsResult(b.dataset.approve,p);await showSample(id)}catch(e){alert(e.message)}});
}

async function enterResult(testId,sample){const t=sample.tests.find(x=>x.id===testId);if(!t)return;const raw=prompt('Enter result for '+t.method_name+' ('+t.result_type+(t.default_unit?' · '+t.default_unit:'')+'):');if(raw===null)return;const v=raw.trim();if(!v)return alert('Result cannot be blank');try{const payload={rawValue:v,unit:t.default_unit||null};if(t.result_type==='NUMERIC'){const n=Number(v);if(!Number.isFinite(n))throw Error('Numeric result required');payload.valueNumeric=n}else payload.valueText=v;if(t.instrument_reference)payload.instrumentReference=t.instrument_reference;await EWASCO_API.enterLimsResult(testId,payload);await showSample(sample.id)}catch(e){alert(e.message)}}

async function renderWorklist(){
 const rows=await EWASCO_API.limsWorklist();state.cache.worklist=rows;
 $('content').innerHTML=`<div class="toolbar"><select id="wlFilter" class="input" style="max-width:220px"><option value="">All statuses</option>${['PLANNED','ASSIGNED','IN_PROGRESS','RESULT_ENTERED','REVIEWED','APPROVED'].map(s=>'<option>'+s+'</option>').join('')}</select><button class="btn" id="wlRefresh">Refresh</button></div><div id="wlTable"></div>`;
 const draw=rs=>{$('wlTable').innerHTML='<div class="table-wrap"><table class="table"><thead><tr><th>Sample</th><th>Point</th><th>Method</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead><tbody>'+ (rs.map(r=>'<tr><td><b>'+esc(r.sample_no)+'</b></td><td>'+esc(r.sampling_point_code||'—')+'</td><td>'+esc(r.method_code)+'<br><span class="note">'+esc(r.analyte)+'</span></td><td><span class="badge">'+esc(r.status)+'</span></td><td>'+fmt(r.due_at)+'</td><td><button class="btn" data-wl="'+r.id+'">Open sample</button></td></tr>').join('')||'<tr><td colspan="6" class="empty">No worklist items.</td></tr>')+'</tbody></table></div>';document.querySelectorAll('[data-wl]').forEach(b=>b.onclick=async()=>{const r=rows.find(x=>x.id===b.dataset.wl);await showSample(r.sample_id)})};
 $('wlFilter').onchange=()=>draw(rows.filter(r=>!$('wlFilter').value||r.status===$('wlFilter').value));$('wlRefresh').onclick=renderWorklist;draw(rows);
}
async function renderPoints(){
 const rows=await EWASCO_API.samplingPoints();state.cache.points=rows;
 $('content').innerHTML=`<div class="toolbar">${canSetup()?'<button class="btn primary" id="addPoint">Add sampling point</button>':''}<button class="btn" id="rp">Refresh</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Location</th><th>State</th></tr></thead><tbody>${rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.location||'—')+'</td><td><span class="badge '+(r.active?'good':'')+'">'+(r.active?'Active':'Inactive')+'</span></td></tr>').join('')||'<tr><td colspan="5" class="empty">No sampling points configured.</td></tr>'}</tbody></table></div>`;
 if(canSetup())$('addPoint').onclick=async()=>{const code=prompt('Sampling point code:');if(!code)return;const name=prompt('Sampling point name:');if(!name)return;const category=prompt('Category:','GENERAL')||'GENERAL';const location=prompt('Location (optional):')||null;try{await EWASCO_API.createSamplingPoint({code,name,category,location});await renderPoints()}catch(e){alert(e.message)}};$('rp').onclick=renderPoints;
}
async function renderMethods(){
 const rows=await EWASCO_API.limsMethods();state.cache.methods=rows;
 $('content').innerHTML=`<div class="toolbar">${canSetup()?'<button class="btn primary" id="addMethod">Add test method</button>':''}<button class="btn" id="rm">Refresh</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Name</th><th>Analyte</th><th>Result type</th><th>Unit</th><th>Reference</th><th>State</th></tr></thead><tbody>${rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.analyte)+'</td><td>'+esc(r.result_type)+'</td><td>'+esc(r.default_unit||'—')+'</td><td>'+esc((r.method_reference||'—')+' '+(r.method_version?'v'+r.method_version:''))+'</td><td><span class="badge '+(r.active?'good':'')+'">'+(r.active?'Active':'Inactive')+'</span></td></tr>').join('')||'<tr><td colspan="7" class="empty">No test methods configured. Do not add methods or references you have not verified.</td></tr>'}</tbody></table></div>`;
 if(canSetup())$('addMethod').onclick=async()=>{const code=prompt('Method code:');if(!code)return;const name=prompt('Method name:');if(!name)return;const analyte=prompt('Analyte / parameter:');if(!analyte)return;const resultType=prompt('Result type: NUMERIC, TEXT or QUALITATIVE','NUMERIC')?.toUpperCase();if(!['NUMERIC','TEXT','QUALITATIVE'].includes(resultType))return alert('Invalid result type');const defaultUnit=prompt('Default unit (optional):')||null;const ref=prompt('Method reference (optional, verified source only):')||null;const ver=prompt('Method version (optional):')||null;try{await EWASCO_API.createLimsMethod({code,name,analyte,resultType,defaultUnit,methodReference:ref,methodVersion:ver});await renderMethods()}catch(e){alert(e.message)}};$('rm').onclick=renderMethods;
}
async function renderSpecs(){
 const rows=await EWASCO_API.limsSpecifications();state.cache.specs=rows;
 $('content').innerHTML=`<div class="toolbar"><span class="note">No regulatory limits are preloaded here. Add only verified organisational or external specifications and record the source.</span>${canSetup()?'<button class="btn primary" id="addSpec">Add specification</button>':''}<button class="btn" id="rs">Refresh</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Parameter</th><th>Rule</th><th>Unit</th><th>Source</th><th>State</th></tr></thead><tbody>${rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.parameter)+'</td><td>'+esc(r.operator)+' '+esc(r.lower_limit??'')+(r.operator==='BETWEEN'?' to '+esc(r.upper_limit):'')+'</td><td>'+esc(r.target_unit||'—')+'</td><td>'+esc(r.source_reference||'Not recorded')+'</td><td><span class="badge '+(r.active?'good':'')+'">'+(r.active?'Active':'Inactive')+'</span></td></tr>').join('')||'<tr><td colspan="6" class="empty">No specifications configured.</td></tr>'}</tbody></table></div>`;
 if(canSetup())$('addSpec').onclick=async()=>{const code=prompt('Specification code:');if(!code)return;const name=prompt('Specification name:');if(!name)return;const parameter=prompt('Parameter:');if(!parameter)return;const op=(prompt('Operator: BETWEEN, LT, LTE, GT, GTE, EQ, NEQ or IS_NOT_NULL','BETWEEN')||'').toUpperCase();if(!['BETWEEN','LT','LTE','GT','GTE','EQ','NEQ','IS_NOT_NULL'].includes(op))return alert('Invalid operator');let lo=null,hi=null;if(op!=='IS_NOT_NULL'){lo=Number(prompt('Lower/primary limit:','0'));if(!Number.isFinite(lo))return alert('Invalid limit');if(op==='BETWEEN'){hi=Number(prompt('Upper limit:','0'));if(!Number.isFinite(hi))return alert('Invalid upper limit')}}const unit=prompt('Target unit (optional):')||null;const source=prompt('Source / document reference:')||null;try{await EWASCO_API.createLimsSpecification({code,name,parameter,operator:op,lowerLimit:lo,upperLimit:hi,targetUnit:unit,sourceReference:source});await renderSpecs()}catch(e){alert(e.message)}};$('rs').onclick=renderSpecs;
}

async function renderSecurity(){
 const users=await EWASCO_API.users().catch(()=>null);
 $('content').innerHTML=`
 <div class="security-grid">
  <section class="card"><h3>Account security</h3><p class="note">Password changes require the current password. Other active sessions are revoked after a successful change.</p><form id="pwForm"><label>Current password<input id="pw_current" class="input" type="password" required></label><label>New password<input id="pw_new" class="input" type="password" minlength="12" required></label><button class="btn primary">Change password</button><p id="pwMsg" class="error"></p></form></section>
  <section class="card"><h3>Security controls</h3><div class="note">Authenticated PostgreSQL-backed sessions · HttpOnly + Secure + SameSite=Strict cookie · CSRF protection · login throttling + account lockout · organisation-scoped data access · generic server errors · controlled result approval with password re-authentication.</div></section>
 </div>
 ${canUsers()?'<section class="card section-card"><div class="bar"><h3>User administration</h3><span class="spacer"></span><button class="btn primary" id="addUser">Create user</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Username</th><th>Role</th><th>State</th><th>Last login</th><th>Actions</th></tr></thead><tbody>'+((users||[]).map(u=>'<tr><td>'+esc(u.username)+'</td><td>'+esc(u.role)+'</td><td><span class="badge '+(u.disabled?'bad':'good')+'">'+(u.disabled?'Disabled':'Active')+'</span></td><td>'+fmt(u.last_login_at)+'</td><td><button class="btn" data-user="'+u.id+'">Manage</button></td></tr>').join('')||'')+'</tbody></table></div></section>':''}
 <div class="warning section-card">Security note: approval is intentionally a separate action from result entry. The server rejects self-review/self-approval and locks approved results against ordinary edits.</div>`;
 $('pwForm').onsubmit=async e=>{e.preventDefault();try{await EWASCO_API.changePassword($('pw_current').value,$('pw_new').value);$('pwMsg').textContent='Password changed; other active sessions were revoked.';$('pwMsg').className='success'}catch(err){$('pwMsg').textContent=err.message}};
 if(canUsers()){$('addUser').onclick=()=>openUserForm();document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>manageUser((users||[]).find(u=>u.id===b.dataset.user)))}
}
function openUserForm(){
 const html='<div class="overlay" id="userModal"><div class="card modal"><div class="bar"><h3>Create user</h3><span class="spacer"></span><button class="btn" id="uclose">Close</button></div><label>Username<input id="un" class="input" autocomplete="off"></label><label>Password<input id="up" class="input" type="password" minlength="12"></label><label>Role<select id="ur" class="input">'+['Administrator','Laboratory Manager','Analyst/Chemist','Storekeeper'].map(x=>'<option>'+x+'</option>').join('')+'</select></label><p id="ue" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="usave">Create</button></div></div></div>';
 document.body.insertAdjacentHTML('beforeend',html);$('uclose').onclick=()=>$('userModal').remove();$('usave').onclick=async()=>{try{const r=await EWASCO_API.createUser({username:$('un').value,password:$('up').value,role:$('ur').value,disabled:false});$('userModal').remove();toast('Created '+r.username,true);await renderSecurity()}catch(e){$('ue').textContent=e.message}}
}
function manageUser(u){if(!u)return;const changeRole=prompt('Role for '+u.username+' (Administrator / Laboratory Manager / Analyst/Chemist / Storekeeper):',u.role);if(changeRole===null)return;const reset=confirm('Reset this user password?');const pw=reset?prompt('New password (12+ chars, upper/lower/number):'):null;if(reset&&pw===null)return;const nextState=u.disabled?'enable':'disable';const changeState=confirm((u.disabled?'Enable ':'Disable ')+u.username+'?');const payload={role:changeRole||u.role};if(changeState)payload.disabled=!u.disabled; if(reset&&pw)payload.password=pw;EWASCO_API.updateUser(u.id,payload).then(()=>renderSecurity()).catch(e=>alert(e.message))}
async function renderSettings(){
 const rows=await EWASCO_API.list('settings');
 const s=rows.find(row=>row.id==='SETTINGS-BASELINE')||rows[0];
 if(!s){$('content').innerHTML='<div class="card"><h3>Settings</h3><p class="empty">No Settings baseline has been initialized.</p></div>';return}
 const item=(label,value)=>'<div class="setting-item"><div class="setting-label">'+esc(label)+'</div><div class="setting-value">'+esc(value??'—')+'</div></div>';
 $('content').innerHTML=`
 <div class="page-head"><h2>System settings</h2><div class="actions">${state.user.role==='Administrator'?'<button class="btn primary" id="settingsEdit">Edit settings</button>':''}</div></div>
 <section class="card section-card">
  <div class="settings-grid">
   ${item('System name',s.systemName||'Not configured')}
   ${item('Organization name',s.organizationName||'Not configured')}
   ${item('Application version',s.applicationVersion||'Not configured')}
   <div class="setting-item"><div class="setting-label">Baseline initialized</div><div class="setting-value"><span class="badge ${s.baselineInitialized?'good':'warn'}">${s.baselineInitialized?'Yes':'No'}</span></div></div>
  </div>
  <p class="note" style="margin-top:14px">These are organization-scoped system baseline settings. Edits are saved through the API and should appear in the audit trail.</p>
 </section>`;
 if(state.user.role==='Administrator')$('settingsEdit').onclick=()=>settingsEditDialog(s);
}
function settingsEditDialog(s){
 const html='<div class="overlay" id="settingsModal"><div class="card modal"><div class="bar"><h3>Edit Settings</h3><span class="spacer"></span><button class="btn" id="setClose">Close</button></div>'+
 '<label>System name<input id="setSystemEdit" class="input" value="'+esc(s.systemName||'')+'"></label>'+
 '<label>Organization name<input id="setOrgEdit" class="input" value="'+esc(s.organizationName||'')+'"></label>'+
 '<label>Application version<input id="setVersionEdit" class="input" value="'+esc(s.applicationVersion||'')+'"></label>'+
 '<p class="mini muted">Baseline initialization is system-controlled.</p><p id="setErr" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="setSave">Save changes</button></div></div></div>';
 document.body.insertAdjacentHTML('beforeend',html);
 $('setClose').onclick=()=>$('settingsModal').remove();
 $('setSave').onclick=async()=>{try{
   const next={...s,systemName:$('setSystemEdit').value.trim(),organizationName:$('setOrgEdit').value.trim(),applicationVersion:$('setVersionEdit').value.trim()};
   if(!next.systemName||!next.organizationName||!next.applicationVersion)throw Error('System name, organization name, and application version are required');
   await EWASCO_API.update('settings',s.id,next,s._version||0);
   $('settingsModal').remove();toast('Settings saved',true);await renderSettings();
 }catch(e){$('setErr').textContent=e.message}}
}
async function renderLegacy(entity){
 if(entity==='audit'){const rows=await fetch('/api/audit',{credentials:'include'}).then(async r=>{if(!r.ok)throw Error((await r.json()).error||'Forbidden');return r.json()});$('content').innerHTML='<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Record</th><th>Data</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+fmt(r.created_at)+'</td><td>'+esc(r.username||'system')+'</td><td>'+esc(r.action)+'</td><td>'+esc(r.entity)+'</td><td>'+esc(r.record_id||'—')+'</td><td><code>'+esc(JSON.stringify(r.data||{}))+'</code></td></tr>').join('')+'</tbody></table></div>';return}
 const rows=await EWASCO_API.list(entity);if(entity==='sds')return renderSDS(rows);
 $('content').innerHTML=`
 <div class="toolbar"><button class="btn primary" id="legacyNew">New record</button><input id="legacySearch" class="input" placeholder="Search JSON…" style="max-width:340px"><span class="spacer"></span><span class="note">Legacy modules remain API-backed during the LIMS migration.</span></div>
 <div id="legacyTable"></div>`;
 const draw=()=>{const q=$('legacySearch').value.toLowerCase(),rs=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));const keys=[...new Set(rs.flatMap(r=>Object.keys(r).filter(k=>!k.startsWith('_'))))].slice(0,7);$('legacyTable').innerHTML='<div class="table-wrap"><table class="table"><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'<th>Actions</th></tr></thead><tbody>'+rs.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])+'</td>').join('')+'<td><button class="btn" data-edit="'+esc(r.id)+'">Edit</button></td></tr>').join('')+'</tbody></table></div>'};$('legacySearch').oninput=draw;draw();$('legacyNew').onclick=()=>legacyEdit(entity,rows,null);document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>legacyEdit(entity,rows,b.dataset.edit));
}
async function renderSDS(rows){
$('content').innerHTML='<div class="page-head"><h2>SDS / MSDS</h2><div class="actions"><button class="btn" id="sdsRefresh">Refresh</button><button class="btn primary" id="sdsNew">New SDS / MSDS</button></div></div><div class="card" style="margin-bottom:12px"><p><b>Automatic extraction with controlled review:</b> the system reads Word, PDF, or Excel SDS documents. If any required field is missing or ambiguous, the record remains pending review until a user completes it.</p><p class="mini muted">Accepted: Word (.docx), PDF (.pdf), Excel (.xlsx). Maximum 10 MB. JSON is not accepted. The system never guesses ambiguous CAS numbers or revision dates.</p></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Manufacturer</th><th>Product / Chemical</th><th>CAS</th><th>Revision date</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.name||r.title||r.id)+'</td><td>'+esc(r.manufacturer||'—')+'</td><td>'+esc(r.product||r.chemical||'—')+'</td><td>'+esc(r.cas||'—')+'</td><td>'+esc(r.revisionDate||'—')+'</td><td><span class="badge '+(r.status==='ACTIVE'?'good':'')+'">'+esc(r.status||'ACTIVE')+'</span></td><td>'+((r.status==='PENDING_REVIEW')?'<button class="btn primary" data-sds-review="'+esc(r.id)+'">Review</button> ':'')+'<button class="btn" data-sds-upload="'+esc(r.id)+'">Analyze / Replace</button> <button class="btn" data-sds-history="'+esc(r.id)+'">History</button></td></tr>').join('')+'</tbody></table></div>';
$('sdsRefresh').onclick=()=>renderLegacy('sds');$('sdsNew').onclick=()=>sdsCreateDialog();document.querySelectorAll('[data-sds-upload]').forEach(b=>b.onclick=()=>sdsUploadDialog(b.dataset.sdsUpload));document.querySelectorAll('[data-sds-review]').forEach(b=>b.onclick=async()=>{const r=rows.find(x=>x.id===b.dataset.sdsReview);if(r)await sdsReviewDialog(r,null)});document.querySelectorAll('[data-sds-history]').forEach(b=>b.onclick=()=>sdsHistoryDialog(b.dataset.sdsHistory));
}
function sdsReviewDialog(record,importResult){
const md=importResult?.metadata||record||{};const candidates=importResult?.casCandidates||md.casCandidates||[];
const casValue=md.cas||'';
const html='<div class="overlay" id="sdsReviewModal"><div class="card modal"><div class="bar"><h3>Review SDS / MSDS metadata</h3><span class="spacer"></span><button class="btn" id="src">Close</button></div><p class="note">Review the extracted information before the SDS becomes active. Nothing ambiguous is guessed.</p><div class="form-grid"><label>SDS / MSDS name<input id="sr_name" class="input" value="'+esc(md.name||'')+'" required></label><label>Manufacturer<input id="sr_manufacturer" class="input" value="'+esc(md.manufacturer||'')+'" required></label><label>Product / Chemical<input id="sr_product" class="input" value="'+esc(md.product||'')+'" required></label><label>CAS number'+(candidates.length>1?'<select id="sr_cas" class="input"><option value="">Select detected CAS</option>'+candidates.map(x=>'<option value="'+esc(x)+'"'+(x===casValue?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select><div class="mini muted">Or enter a CAS number manually below.</div>':'')+'<input id="sr_cas_manual" class="input" placeholder="e.g. 7681-52-9" value="'+esc(casValue)+'" required></label><label>Revision date<input id="sr_revision" class="input" type="date" value="'+esc(md.revisionDate||'')+'" required></label></div><p id="sre" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="srs">Save & Activate</button></div></div></div>';
document.body.insertAdjacentHTML('beforeend',html);$('src').onclick=()=>$('sdsReviewModal').remove();
if(candidates.length>1)$('sr_cas').onchange=()=>{if($('sr_cas').value)$('sr_cas_manual').value=$('sr_cas').value};
$('srs').onclick=async()=>{try{const name=$('sr_name').value.trim(),manufacturer=$('sr_manufacturer').value.trim(),product=$('sr_product').value.trim(),cas=$('sr_cas_manual').value.trim(),revisionDate=$('sr_revision').value;if(!name||!manufacturer||!product||!cas||!revisionDate)throw Error('Complete all required SDS metadata fields before activation');if(!EWASCO_VALIDATE.isCas(cas))throw Error('Enter a valid CAS number in the form 12345-67-8');const next={...(record||{}),id:record?.id||importResult?.id,name,manufacturer,product,cas,revisionDate,status:'ACTIVE',metadataSource:'document+manual-review',metadataExtraction:'deterministic'};const r=await EWASCO_API.update('sds',next.id,next,record?record._version||record.version||0:importResult?.version||0);$('sdsReviewModal').remove();toast('SDS metadata reviewed and activated',true);await renderLegacy('sds')}catch(e){$('sre').textContent=e.message}};
}
function sdsUploadDialog(id){
const html='<div class="overlay" id="sdsUploadModal"><div class="card modal"><div class="bar"><h3>Analyze & Replace SDS / MSDS</h3><span class="spacer"></span><button class="btn" id="suc">Close</button></div><p>Select the replacement Word, PDF, or Excel SDS document. Extracted metadata will be shown for review when incomplete or ambiguous.</p><input id="sfile" type="file" class="input" accept=".docx,.pdf,.xlsx"><p id="sue" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="sus">Analyze & Upload</button></div></div></div>';
document.body.insertAdjacentHTML('beforeend',html);$('suc').onclick=()=>$('sdsUploadModal').remove();
$('sus').onclick=async()=>{try{const f=$('sfile').files[0];if(!f)throw Error('Select a Word, PDF, or Excel SDS file');if(!EWASCO_VALIDATE.isSdsFile(f))throw Error(EWASCO_VALIDATE.sdsFileError(f));if(f.size>10*1024*1024)throw Error('File is larger than the 10 MB limit');$('sus').disabled=true;$('sus').textContent='Reading SDS…';const r=await EWASCO_API.sdsImport(id,f);$('sdsUploadModal').remove();if(r.requiresReview){await sdsReviewDialog(r.metadata,r)}else{toast('SDS analyzed and activated: '+(r.metadata.product||r.id),true);await renderLegacy('sds')}}catch(e){$('sus').disabled=false;$('sus').textContent='Analyze & Upload';$('sue').textContent=e.message}};
}
async function sdsCreateDialog(){
const id='SDS-'+crypto.randomUUID().slice(0,8);
const html='<div class="overlay" id="sdsCreateModal"><div class="card modal"><div class="bar"><h3>Analyze & Upload SDS / MSDS</h3><span class="spacer"></span><button class="btn" id="scc">Close</button></div><p class="note">The system extracts metadata automatically. If anything is missing or ambiguous, you will be asked to review and complete it manually before activation.</p><input id="scfile" type="file" class="input" accept=".docx,.pdf,.xlsx"><p class="mini muted">Accepted: Word (.docx), PDF (.pdf), Excel (.xlsx). Maximum 10 MB. JSON is not accepted.</p><p id="sce" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="scs">Analyze & Upload</button></div></div></div>';
document.body.insertAdjacentHTML('beforeend',html);$('scc').onclick=()=>$('sdsCreateModal').remove();
$('scs').onclick=async()=>{try{const file=$('scfile').files[0];if(!file)throw Error('Select a Word, PDF, or Excel SDS file');if(!EWASCO_VALIDATE.isSdsFile(file))throw Error(EWASCO_VALIDATE.sdsFileError(file));if(file.size>10*1024*1024)throw Error('File is larger than the 10 MB limit');$('scs').disabled=true;$('scs').textContent='Reading SDS…';const r=await EWASCO_API.sdsImport(id,file);$('sdsCreateModal').remove();if(r.requiresReview){await sdsReviewDialog(r.metadata,r)}else{toast('SDS analyzed and activated: '+(r.metadata.product||r.id),true);await renderLegacy('sds')}}catch(e){$('scs').disabled=false;$('scs').textContent='Analyze & Upload';$('sce').textContent=e.message}};
}
function legacyEdit(entity,rows,id){
  const rec=id?rows.find(r=>r.id===id):{id:entity.toUpperCase()+'-'+crypto.randomUUID().slice(0,8)};
  const html='<div class="overlay" id="legacyModal"><div class="card modal"><div class="bar"><h3>'+esc(id?'Edit':'Create')+' '+esc(entity)+'</h3><span class="spacer"></span><button class="btn" id="lc">Close</button></div><textarea id="lj" class="input" style="min-height:300px">'+esc(JSON.stringify(rec,null,2))+'</textarea><p id="le" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="ls">Save</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);$('lc').onclick=()=>$('legacyModal').remove();
  $('ls').onclick=async()=>{try{const next=JSON.parse($('lj').value);const r=id?await EWASCO_API.update(entity,id,next,next._version||0):await EWASCO_API.create(entity,next);$('legacyModal').remove();toast('Saved '+r.id,true);await renderLegacy(entity)}catch(e){$('le').textContent=e.message}};
}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const x=await EWASCO_API.login($('username').value,$('password').value);state.user=x.user;showApp();await go('dashboard')}catch(e){$('loginError').textContent=e.message}};
$('logout').onclick=async()=>{try{await EWASCO_API.logout()}finally{location.reload()}};
boot();
