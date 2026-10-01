async function renderSDS(rows){
$('content').innerHTML='<div class="page-head"><h2>SDS / MSDS</h2><div class="actions"><button class="btn" id="sdsRefresh">Refresh</button><button class="btn primary" id="sdsNew">New SDS / MSDS</button></div></div><div class="card section-card"><div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Name</th><th>Manufacturer</th><th>Product</th><th>CAS</th><th>Revision</th><th>Actions</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.name || '—') + '</td><td>' + esc(r.manufacturer || '—') + '</td><td>' + esc(r.product || '—') + '</td><td>' + esc(r.cas || '—') + '</td><td>' + esc(r.revisionDate || '—') + '</td><td><button class="btn small" data-sds-upload="' + esc(r.id) + '">Replace</button></td></tr>').join('') + '</tbody></table></div></div>';
$('sdsRefresh').onclick=()=>renderLegacy('sds');$('sdsNew').onclick=()=>sdsCreateDialog();document.querySelectorAll('[data-sds-upload]').forEach(b=>b.onclick=()=>sdsUploadDialog(b.dataset.sdsUpload));
}
function openSdsReview(id, metadata, version){
  const html='<div class="overlay" id="sdsReviewModal"><div class="card modal"><div class="bar"><h3>Review extracted SDS information</h3><span class="spacer"></span><button class="btn" id="sdsReviewClose">Close</button></div><div class="form-grid"><label>SDS / MSDS Name<input id="review_name" class="input" value="'+esc(metadata.name||'')+'"></label><label>Manufacturer<input id="review_manufacturer" class="input" value="'+esc(metadata.manufacturer||'')+'"></label><label>Product / Chemical<input id="review_product" class="input" value="'+esc(metadata.product||'')+'"></label><label>CAS Number<input id="review_cas" class="input" value="'+esc(metadata.cas||'')+'"></label><label>Revision Date<input id="review_date" class="input" type="date" value="'+(metadata.revisionDate||'')+'"></label></div><p class="note">Missing or ambiguous values can be completed manually. CAS numbers and revision dates are not guessed.</p><div class="bar"><span class="spacer"></span><button class="btn primary" id="sdsReviewSave">Save SDS</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  $('sdsReviewClose').onclick=()=>$('sdsReviewModal').remove();
  $('sdsReviewSave').onclick=async()=>{
    const next={
      id,
      name:$('review_name').value.trim(),
      manufacturer:$('review_manufacturer').value.trim(),
      product:$('review_product').value.trim(),
      cas:$('review_cas').value.trim(),
      revisionDate:$('review_date').value || null,
      metadataSource:'manual_review',
      metadataExtraction:'manual_review'
    };
    if(!next.name||!next.manufacturer||!next.product){alert('SDS name, manufacturer, and product are required.');return}
    try{
      await EWASCO_API.update('sds',id,next,version||0);
      $('sdsReviewModal').remove();
      toast('SDS record updated.',true);
      await renderLegacy('sds');
    }catch(e){alert(e.message)}
  };
}
function sdsUploadDialog(id){
const html='<div class="overlay" id="sdsUploadModal"><div class="card modal"><div class="bar"><h3>Analyze & Replace SDS / MSDS</h3><span class="spacer"></span><button class="btn" id="suc">Close</button></div><div class="form-grid"><label>Replace file<input id="sfile" class="input" type="file" accept=".pdf,.docx,.xlsx"></label></div><p id="suErr" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="sus">Upload & Analyze</button></div></div></div>';
document.body.insertAdjacentHTML('beforeend',html);$('suc').onclick=()=>$('sdsUploadModal').remove();
$('sus').onclick=async()=>{try{const f=$('sfile').files[0];if(!f)throw Error('Select a Word, PDF, or Excel SDS file');if(!/\.(docx|pdf|xlsx)$/i.test(f.name))throw Error('Only Word (.docx), PDF (.pdf), or Excel (.xlsx) files are accepted');const result=await EWASCO_API.sdsImport(id,f);if(result.requiresReview){$('sdsUploadModal').remove();openSdsReview(id,result.metadata,result.version);return}$('sdsUploadModal').remove();toast('SDS updated and analyzed',true);await renderLegacy('sds')}catch(e){$('suErr').textContent=e.message}};
}
async function sdsCreateDialog(){
const id='SDS-'+crypto.randomUUID().slice(0,8);
const html='<div class="overlay" id="sdsCreateModal"><div class="card modal"><div class="bar"><h3>Analyze & Upload SDS / MSDS</h3><span class="spacer"></span><button class="btn" id="scc">Close</button></div><div class="form-grid"><label>Select file<input id="scfile" class="input" type="file" accept=".pdf,.docx,.xlsx"></label></div><p id="scErr" class="error"></p><div class="bar"><span class="spacer"></span><button class="btn primary" id="scs">Upload & Analyze</button></div></div></div>';
document.body.insertAdjacentHTML('beforeend',html);$('scc').onclick=()=>$('sdsCreateModal').remove();
$('scs').onclick=async()=>{try{const file=$('scfile').files[0];if(!file)throw Error('Select a Word, PDF, or Excel SDS file');if(!/\.(docx|pdf|xlsx)$/i.test(file.name))throw Error('Only Word (.docx), PDF (.pdf), or Excel (.xlsx) files are accepted');const result=await EWASCO_API.sdsImport(id,file);if(result.requiresReview){$('sdsCreateModal').remove();openSdsReview(id,result.metadata,result.version);return}$('sdsCreateModal').remove();toast('SDS uploaded and analyzed',true);await renderLegacy('sds')}catch(e){$('scErr').textContent=e.message}};
}
