const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)]; let currentOrder=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function formatOrder(v){const d=String(v).replace(/\D/g,'').slice(0,12);if(d.length<=2)return d;if(d.length<=7)return d.slice(0,2)+'-'+d.slice(2);return d.slice(0,2)+'-'+d.slice(2,7)+'-'+d.slice(7)}
async function api(url,opt={}){const r=await fetch(url,opt),j=await r.json().catch(()=>({error:'Unexpected response'}));if(r.status===401&&j.pin_required){$('#pinGate').classList.remove('hidden');throw new Error('Enter the app PIN to continue.')}if(!r.ok)throw new Error(j.error||'Request failed');return j}
$('#orderInput').addEventListener('input',e=>e.target.value=formatOrder(e.target.value));

let orderSpeechRecognition=null;
$('#speakOrder').onclick=()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('Direct voice recognition is not available in this browser. The number-pad entry will continue to work normally.');return;}
  const r=new SR(); orderSpeechRecognition=r; r.lang='en-US'; r.interimResults=false; r.maxAlternatives=3;
  $('#speakOrder').textContent='🎤 Listening…'; $('#cancelSpeakOrder').classList.remove('hidden');
  r.onresult=e=>{
    const spoken=Array.from(e.results[0]||[]).map(x=>x.transcript).join(' ');
    let d=String(spoken).replace(/\b(zero|oh)\b/gi,'0').replace(/\bone\b/gi,'1').replace(/\btwo\b/gi,'2').replace(/\bthree\b/gi,'3').replace(/\bfour\b/gi,'4').replace(/\bfive\b/gi,'5').replace(/\bsix\b/gi,'6').replace(/\bseven\b/gi,'7').replace(/\beight\b/gi,'8').replace(/\bnine\b/gi,'9').replace(/\D/g,'').slice(0,12);
    $('#orderInput').value=formatOrder(d);
    if(d.length!==12) $('#orderError').textContent='I heard '+d.length+' digits. Please check the order number before searching.';
  };
  r.onerror=e=>{if(e.error!=='aborted')$('#orderError').textContent='Voice recognition did not get the order number. Please try again or use the number pad.'};
  r.onend=()=>{$('#speakOrder').textContent='🎤 Speak Order';$('#cancelSpeakOrder').classList.add('hidden');orderSpeechRecognition=null};
  try{r.start()}catch(e){$('#speakOrder').textContent='🎤 Speak Order'}
};

$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));$$('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.tab).classList.add('active');if(b.dataset.tab==='back')loadQueue();if(b.dataset.tab==='archived')loadArchive()});
(async()=>{try{const c=await api('/api/config');if(c.pinRequired&&!c.authenticated)$('#pinGate').classList.remove('hidden')}catch(e){$('#pinGate').classList.remove('hidden')}})();
$('#pinForm').onsubmit=async e=>{e.preventDefault();const j=await api('/api/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:$('#pin').value})});if(j.ok){$('#pinError').textContent='';$('#pinGate').classList.add('hidden')}else $('#pinError').textContent='Incorrect PIN'};
$('#cancelSpeakOrder').onclick=()=>{if(orderSpeechRecognition){try{orderSpeechRecognition.abort()}catch{}}$('#cancelSpeakOrder').classList.add('hidden');$('#speakOrder').textContent='🎤 Speak Order';$('#orderInput').focus();};
$('#findOrder').onclick=async()=>{
  try{
    $('#orderError').textContent=''; $('#orderResults').innerHTML='<div class="card">Checking…</div>';
    const order=formatOrder($('#orderInput').value);
    const chk=await api('/api/returns/check-order/'+encodeURIComponent(order));
    if(chk.exists){
      const r=chk.record||{};
      $('#orderResults').innerHTML=`<div class="card error"><h2>RETURN ALREADY PROCESSED</h2><div><b>Order:</b> ${esc(order)}</div><div><b>Status:</b> ${esc(r.status)}</div><div><b>SKU:</b> ${esc(r.sku||'')}</div><div><b>Location:</b> ${esc(r.location||'')}</div><p>This order cannot be processed again unless its existing return record is deleted.</p></div>`;
      return;
    }
    $('#orderResults').innerHTML='<div class="card">Loading SellerChamp order…</div>';
    const j=await api('/api/order/'+encodeURIComponent(order)); currentOrder=j.order; renderOrder(j.order);
  }catch(e){$('#orderResults').innerHTML='';$('#orderError').textContent=e.message}
};
function cond(p){
  const raw=p?.item_condition;
  if(raw!==undefined&&raw!==null&&raw!==''){
    const v=String(raw).trim().toLowerCase();
    const labels={new:'New',like_new:'Like New',very_good:'Very Good',good:'Good',acceptable:'Acceptable',refurbished:'Refurbished',salvage:'For Parts / Salvage',used:'Used'};
    if(labels[v])return labels[v];
    if(!/^\d+$/.test(v))return String(raw).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  const id=String(p?.ebay_item_condition_id??p?.item_condition_id??raw??'').trim();
  const ids={'1000':'New','1500':'New Other','1750':'New With Defects','2000':'Certified Refurbished','2010':'Excellent - Refurbished','2020':'Very Good - Refurbished','2030':'Good - Refurbished','2500':'Seller Refurbished','3000':'Used','4000':'Very Good','5000':'Good','6000':'Acceptable','7000':'For Parts or Not Working'};
  return ids[id]||id||'Unknown';
}
function itemRemarks(p){return String(p?.item_remarks??'').trim()}
function renderOrder(o){$('#orderResults').innerHTML=(o.items||[]).map((it,i)=>`<div class="card"><h2>${esc(it.title)}</h2><div class="meta"><div><b>Order:</b> ${esc(o.order_number)}</div><div><b>SKU:</b> ${esc(it.sku)}</div><div><b>eBay Condition:</b> ${esc(cond(it.product))} - ${esc(itemRemarks(it.product)||'No Item Remarks')}</div><div><b>Qty Ordered:</b> ${esc(it.quantity)}</div><div><b>Condition:</b> ${esc(cond(it.product))}</div></div><div class="links">${it.sellerchamp_url?`<a target="_blank" href="${esc(it.sellerchamp_url)}">View in SellerChamp</a>`:''}${it.ebay_url?`<a target="_blank" href="${esc(it.ebay_url)}">View on eBay</a>`:''}</div><form class="intakeForm" data-i="${i}"><label>Quantity Returned</label><input name="returned_qty" inputmode="numeric" type="number" min="1" value="1"><label>What do you physically observe?</label><input name="observed_condition" placeholder="Example: Opened, appears unused"><label>Photos (up to 6)</label><input name="photos" type="file" accept="image/*" capture="environment" multiple><label>What should be done with it?</label><div class="choices"><label class="choice"><input type="radio" name="disposition" value="return_inventory" checked><div><span>Return to normal inventory</span><div class="hint">Same condition as existing stock.</div></div></label><label class="choice"><input type="radio" name="disposition" value="reserve_inventory"><div><span>Return to inventory + reserve</span><div class="hint">Keep it in stock but unavailable until released later.</div></div></label><label class="choice"><input type="radio" name="disposition" value="duplicate_product"><div><span>Create a separate product/listing</span><div class="hint">Substantially different condition.</div></div></label></div><label>Instructions / Notes</label><textarea name="notes" placeholder="Describe what you found and what should be done."></textarea><button type="submit">Save Return & Create Printable PDF</button><p class="msg"></p></form><div class="location">LOCATION: ${esc(it.location||'NO LOCATION')}</div></div>`).join('');$$('.intakeForm').forEach(f=>f.onsubmit=saveReturn)}
async function saveReturn(e){e.preventDefault();const f=e.currentTarget,it=currentOrder.items[Number(f.dataset.i)],fd=new FormData(f);if([...fd.getAll('photos')].filter(x=>x?.size).length>6){f.querySelector('.msg').textContent='Maximum 6 photos.';return}Object.entries({order_number:currentOrder.order_number,order_id:currentOrder.id,marketplace_account_id:currentOrder.marketplace_account_id,marketplace:currentOrder.marketplace,order_item_id:it.order_item_id,sku:it.sku,title:it.title,product_id:it.product?.id||it.product_id||'',marketplace_id:it.product?.marketplace_id||'',original_condition:cond(it.product),item_remarks:itemRemarks(it.product),location:it.location||'',sellerchamp_url:it.sellerchamp_url||'',ebay_url:it.ebay_url||''}).forEach(([k,v])=>fd.append(k,v));try{f.querySelector('.msg').textContent='Saving…';const j=await api('/api/returns',{method:'POST',body:fd});f.querySelector('.msg').innerHTML=`<span class="success">Saved.</span><a class="pdf-button" target="_blank" href="${j.pdf_url}">Open / Print PDF</a>`}catch(err){f.querySelector('.msg').textContent=err.message}}

let archivedRows=[];
const dispositionLabel=v=>({return_inventory:'Return to normal inventory',reserve_inventory:'Return to inventory + reserve',duplicate_product:'Create separate product/listing'}[v]||v||'');
const when=v=>v?new Date(v).toLocaleString():'';
$('#refreshArchive').onclick=loadArchive;
$('#archiveSearch').addEventListener('input',renderArchiveList);
async function loadArchive(){
  try{
    const j=await api('/api/returns?all=1');
    archivedRows=(j.returns||[]).filter(r=>r.status==='archived').sort((a,b)=>String(b.archived_at||'').localeCompare(String(a.archived_at||'')));
    renderArchiveList();
  }catch(e){$('#archiveQueue').innerHTML=`<p class="error">${esc(e.message)}</p>`}
}
function renderArchiveList(){
  const q=String($('#archiveSearch')?.value||'').trim().toLowerCase();
  const rows=archivedRows.filter(r=>!q||[r.order_number,r.sku,r.title,r.location,r.notes,r.observed_condition,r.disposition].some(v=>String(v||'').toLowerCase().includes(q)));
  $('#archiveQueue').innerHTML=rows.length?rows.map(r=>`<div class="queue-row archived-row"><strong>${esc(r.location||'NO LOC')}</strong><div><b>${esc(r.sku)}</b><br>${esc(r.title)}<br><span class="badge">${esc(dispositionLabel(r.disposition))}</span><br><span class="hint">Archived ${esc(when(r.archived_at))}</span></div><button onclick="showArchived('${r.id}')">Review</button></div>`).join(''):'<p>No archived returns found.</p>';
}
window.showArchived=async id=>{
  try{
    const r=(await api('/api/returns/'+id)).return;
    const hist=(r.history||[]).slice().reverse().map(h=>`<div class="history-row"><b>${esc(when(h.at))}</b><br>${esc(h.action||'')}<br><span class="hint">${esc(h.details||'')}</span></div>`).join('')||'<p>No processing history recorded.</p>';
    $('#archiveDetail').innerHTML=`<div class="card"><div class="row spread"><div><h2>${esc(r.title)}</h2><span class="badge">ARCHIVED</span></div><div class="hint">${esc(when(r.archived_at))}</div></div><div class="meta"><div><b>Order:</b> ${esc(r.order_number)}</div><div><b>SKU:</b> ${esc(r.sku)}</div><div><b>Qty Returned:</b> ${esc(r.returned_qty)}</div><div><b>Location:</b> ${esc(r.location)}</div><div><b>Original Condition:</b> ${esc(r.original_condition)}</div><div><b>Observed:</b> ${esc(r.observed_condition)}</div><div><b>Front Decision:</b> ${esc(dispositionLabel(r.disposition))}</div><div><b>Status:</b> Archived</div></div><h3>Instructions / Notes</h3><p>${esc(r.notes||'None')}</p><div class="photos">${(r.photos||[]).map(p=>`<img src="${esc(p)}">`).join('')}</div><div class="links"><a class="pdf-button" target="_blank" href="/api/returns/${r.id}/pdf">Open / Print PDF</a>${r.sku?`<a target="_blank" href="https://app2.sellerchamp.com/products?utf8=%E2%9C%93&listings_filter=all&product%5Bmarketplace_manually_removed%5D=false&product%5Bquery%5D=${encodeURIComponent(r.sku)}&product%5Bquery_comparison%5D=&product%5Bquery_field%5D=&product%5Bstatus%5D=&product%5Bitem_condition%5D=all&per_page=50">View in SellerChamp</a>`:''}${r.ebay_url?`<a target="_blank" href="${esc(r.ebay_url)}">eBay</a>`:''}</div><div class="row"><button class="secondary" onclick="restoreArchived('${r.id}')">Move Back to Process Returns</button><button class="danger" onclick="deleteArchived('${r.id}')">Delete Archived Record</button></div></div><div class="card"><h2>Processing History</h2>${hist}</div>`;
    $('#archiveDetail').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){$('#archiveDetail').innerHTML=`<div class="card error">${esc(e.message)}</div>`}
};



window.deleteArchived=async id=>{
  if(!confirm('Permanently delete this archived return and its stored photos? This cannot be undone.'))return;
  try{await api(`/api/returns/${id}/archive-delete`,{method:'DELETE'});$('#archiveDetail').innerHTML='';await loadArchive()}catch(e){alert(e.message)}
};
window.restoreArchived=async id=>{
  if(!confirm('Move this archived return back to 2. Process Returns?'))return;
  try{
    await api(`/api/returns/${id}/restore-to-process`,{method:'POST'});
    $('#archiveDetail').innerHTML=''; await loadArchive();
    alert('Return moved back to 2. Process Returns.');
  }catch(e){alert(e.message)}
};

$('#purgeArchive').onclick=async()=>{
  const count=archivedRows.filter(r=>r.archived_at&&(Date.now()-new Date(r.archived_at).getTime())>60*24*60*60*1000).length;
  if(!count){alert('There are no archived returns older than 60 days.');return;}
  if(!confirm(`Permanently delete ${count} archived return${count===1?'':'s'} older than 60 days, including their stored photos? This cannot be undone.`))return;
  if(!confirm('Final confirmation: permanently delete these old archived returns?'))return;
  try{const j=await api('/api/returns/archive/purge-older-than-60-days',{method:'DELETE'});alert(`Deleted ${j.deleted} archived return${j.deleted===1?'':'s'}.`);$('#archiveDetail').innerHTML='';await loadArchive()}catch(e){alert(e.message)}
};

$('#refreshQueue').onclick=loadQueue;
async function loadQueue(){try{const j=await api('/api/returns');$('#queue').innerHTML=j.returns.length?j.returns.map(r=>`<div class="queue-row"><strong>${esc(r.location||'NO LOC')}</strong><div><b>Order: ${esc(r.order_number)}</b><br><b>${esc(r.sku)}</b><br>${esc(r.title)}<br><span class="badge">${esc(r.disposition)}</span></div><div class="row"><button onclick="showReturn('${r.id}')">Open</button><button class="danger" onclick="deleteReturn('${r.id}','${esc(r.sku)}')">Delete</button></div></div>`).join(''):'<p>No returns waiting.</p>'}catch(e){$('#queue').innerHTML=`<p class="error">${esc(e.message)}</p>`}}

window.deleteReturn=async(id,sku)=>{
  if(!confirm(`Delete return ${sku||''}?\n\nThis permanently deletes the return record and its stored photos. This cannot be undone.\n\nPress OK only if you intended to delete this record.`))return;
  try{
    await api(`/api/returns/${id}/delete`,{method:'DELETE'});
    $('#detail').innerHTML='';
    await loadQueue();
  }catch(e){alert(e.message)}
};

window.showReturn=async id=>{try{const r=(await api('/api/returns/'+id)).return;let inventory='';try{const inv=await api(`/api/returns/${id}/inventory`);inventory=`<div class="card"><h3>Current SellerChamp Inventory</h3>${(inv.inv||[]).map(x=>`<div>${esc(x.location)} — <b>${esc(x.quantity_available)}</b> on hand</div>`).join('')||'<p>No locations.</p>'}</div>`}catch(e){inventory=`<div class="card error">${esc(e.message)}</div>`}$('#detail').innerHTML=`<div class="card"><h2>${esc(r.title)}</h2><div class="meta"><div><b>Order:</b> ${esc(r.order_number)}</div><div><b>SKU:</b> ${esc(r.sku)}</div><div><b>Qty:</b> ${esc(r.returned_qty)}</div><div><b>Location:</b> ${esc(r.location)}</div><div><b>Observed:</b> ${esc(r.observed_condition)}</div><div><b>Front decision:</b> ${esc(r.disposition)}</div></div><h3>Instructions</h3><p>${esc(r.notes||'None')}</p><div class="photos">${r.photos.map(p=>`<img src="${esc(p)}">`).join('')}</div><div class="links"><a class="pdf-button" target="_blank" href="/api/returns/${r.id}/pdf">Open / Print PDF</a>${r.ebay_url?`<a target="_blank" href="${esc(r.ebay_url)}">eBay</a>`:''}</div></div>${inventory}${processPanel(r)}`;try{
  const st=await api(`/api/returns/${id}/listing-status`);
  const el=$('#normalListingStatus');
  if(el){
    const status=String(st.marketplace_status||'unknown').toUpperCase();
    el.innerHTML=`<b>eBay listing status:</b> ${esc(status)}${status!=='ACTIVE'?'<br><span class="error">This listing is not active. After adding the inventory, you will be given the option to activate it.</span>':''}`;
  }
}catch(e){const el=$('#normalListingStatus');if(el)el.innerHTML=`<b>eBay listing status:</b> Unable to determine — ${esc(e.message)}`}
$('#detail').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){$('#detail').innerHTML=`<div class="card error">${esc(e.message)}</div>`}};
function processPanel(r){return `<div class="card"><h2>Process Return</h2><div class="big-choice"><h3>1. Add back to normal inventory</h3><div id="normalListingStatus" class="listing-warning"><b>eBay listing status:</b> Checking…</div><input id="normalLoc" value="${esc(r.location)}"><input id="normalQty" type="number" inputmode="numeric" value="${esc(r.returned_qty)}"><button onclick="doAdd('${r.id}')">Add to Inventory & Complete</button></div><div class="big-choice"><h3>2. Add to inventory + reserve</h3><input id="reserveLoc" value="${esc(r.location)}"><input id="reserveNote" value="${esc(r.location)}"><input id="reserveQty" type="number" value="${esc(r.returned_qty)}"><button onclick="doReserve('${r.id}')">Add + Reserve & Complete</button></div><div class="big-choice"><h3>3. Create separate eBay product/listing</h3><input id="newSku" value="${esc(r.sku)}-RET"><input id="newTitle" value="${esc(r.title)}"><select id="newCondition"><option value="like_new">Like New</option><option value="very_good">Very Good</option><option value="good">Good</option><option value="acceptable">Acceptable</option><option value="refurbished">Refurbished</option><option value="salvage">Salvage</option></select><textarea id="newRemarks">${esc(r.notes)}</textarea><input id="newLoc" value="${esc(r.location)}"><input id="newQty" type="number" value="${esc(r.returned_qty)}"><input id="newPrice" type="number" step="0.01" placeholder="Price"><button onclick="doDuplicate('${r.id}')">Create & Activate Listing</button></div><p id="processMsg"></p></div>`}
window.doAdd=async id=>{
  if(!confirm('Add this quantity back to SellerChamp inventory?'))return;
  try{
    $('#processMsg').textContent='Adding inventory and checking current stock…';
    const j=await api(`/api/returns/${id}/add-inventory`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:$('#normalLoc').value,qty:$('#normalQty').value})});
    const status=String(j.marketplace_status||'unknown').toLowerCase();
    $('#processMsg').innerHTML=`<div class="listing-warning"><b>Inventory added successfully.</b><br><br><b>Current stock at ${esc(j.location||$('#normalLoc').value)}:</b> <span style="font-size:1.35em"><b>${esc(j.quantity_available)}</b></span><br><label>Change quantity if needed</label><div class="row"><input id="correctedStockQty" type="number" inputmode="numeric" min="0" value="${esc(j.quantity_available)}"><button class="secondary" onclick="changeStockQty('${id}')">Update Stock Quantity</button></div><br><b>eBay listing status:</b> ${esc(status.toUpperCase())}<div class="listing-actions">${status==='active'?`<button onclick="archiveActive('${id}')">Quantity Is Correct — Complete & Archive</button>`:`<button onclick="activateAndArchive('${id}')">Activate eBay Item & Archive Return</button><button class="secondary" onclick="leaveInactiveAndArchive('${id}')">Leave Inactive & Archive Return</button>`}</div></div>`;
  }catch(e){$('#processMsg').textContent=e.message}
};
window.changeStockQty=async id=>{
  try{
    const j=await api(`/api/returns/${id}/set-inventory-quantity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:$('#normalLoc').value,quantity:$('#correctedStockQty').value})});
    $('#correctedStockQty').value=j.quantity_available;
    alert(`SellerChamp stock quantity is now ${j.quantity_available} at ${j.location}.`);
  }catch(e){alert(e.message)}
};
window.archiveActive=async id=>{
  try{await api(`/api/returns/${id}/archive-active`,{method:'POST'});$('#detail').innerHTML='';await loadQueue();window.scrollTo({top:0,behavior:'smooth'})}catch(e){$('#processMsg').textContent=e.message}
};
window.activateAndArchive=async id=>{
  if(!confirm('Relist/activate this item on eBay through SellerChamp and archive the return?'))return;
  try{ $('#processMsg').textContent='Sending relist request to SellerChamp…'; const j=await api(`/api/returns/${id}/relist-and-archive`,{method:'POST'}); alert(`Relist request sent. SellerChamp status: ${String(j.marketplace_status||'pending').toUpperCase()}. The return has been archived.`); $('#detail').innerHTML=''; await loadQueue(); window.scrollTo({top:0,behavior:'smooth'}); }catch(e){$('#processMsg').textContent=e.message}
};
window.leaveInactiveAndArchive=async id=>{
  if(!confirm('Leave the eBay item inactive and archive this return?'))return;
  try{ await api(`/api/returns/${id}/archive-inactive`,{method:'POST'}); $('#detail').innerHTML=''; await loadQueue(); window.scrollTo({top:0,behavior:'smooth'}); }catch(e){$('#processMsg').textContent=e.message}
};
window.doReserve=async id=>{if(!confirm('Add this quantity and increase SellerChamp reserve quantity?'))return;try{await api(`/api/returns/${id}/add-reserve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:$('#reserveLoc').value,reserve_location:$('#reserveNote').value,qty:$('#reserveQty').value})});alert('Completed. This return has been archived.');$('#detail').innerHTML='';await loadQueue();window.scrollTo({top:0,behavior:'smooth'})}catch(e){$('#processMsg').textContent=e.message}};
window.doDuplicate=async id=>{if(!confirm('This will create and auto-submit a new SellerChamp/eBay listing. Continue?'))return;try{await api(`/api/returns/${id}/duplicate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:$('#newSku').value,title:$('#newTitle').value,item_condition:$('#newCondition').value,item_remarks:$('#newRemarks').value,location:$('#newLoc').value,qty:$('#newQty').value,retail_price:$('#newPrice').value})});alert('New listing submitted. This return has been archived.');$('#detail').innerHTML='';await loadQueue();window.scrollTo({top:0,behavior:'smooth'})}catch(e){$('#processMsg').textContent=e.message}};


let directProduct=null;
$('#directSearch').onclick=searchDirectSku;
let directSpeechRecognition=null;
$('#directSpeak').onclick=()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('Direct voice recognition is not available in this browser. The number-pad entry will continue to work normally.');return;}
  const r=new SR(); directSpeechRecognition=r; r.lang='en-US'; r.interimResults=false; r.maxAlternatives=3;
  $('#directSpeak').textContent='🎤 Listening…'; $('#cancelDirectSpeak').classList.remove('hidden');
  r.onresult=e=>{
    const spoken=Array.from(e.results[0]||[]).map(x=>x.transcript).join(' ');
    const d=String(spoken).replace(/\b(zero|oh)\b/gi,'0').replace(/\bone\b/gi,'1').replace(/\btwo\b/gi,'2').replace(/\bthree\b/gi,'3').replace(/\bfour\b/gi,'4').replace(/\bfive\b/gi,'5').replace(/\bsix\b/gi,'6').replace(/\bseven\b/gi,'7').replace(/\beight\b/gi,'8').replace(/\bnine\b/gi,'9').replace(/\D/g,'');
    $('#directSku').value=d;
    if(d) searchDirectSku();
  };
  r.onerror=e=>{if(e.error!=='aborted')$('#directError').textContent='Voice recognition did not get the SKU. Please try again or use the number pad.'};
  r.onend=()=>{$('#directSpeak').textContent='🎤 Speak SKU';$('#cancelDirectSpeak').classList.add('hidden');directSpeechRecognition=null};
  try{r.start()}catch(e){$('#directSpeak').textContent='🎤 Speak SKU'}
};

$('#cancelDirectSpeak').onclick=()=>{if(directSpeechRecognition){try{directSpeechRecognition.abort()}catch{}}$('#cancelDirectSpeak').classList.add('hidden');$('#directSpeak').textContent='🎤 Speak SKU';$('#directSku').focus();};
$('#directSku').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchDirectSku()}});
async function searchDirectSku(){
  const sku=$('#directSku').value.trim();
  if(!sku)return;
  $('#directError').textContent=''; $('#directResult').innerHTML='<div class="card">Searching SellerChamp…</div>';
  try{
    const j=await api('/api/direct/sku/'+encodeURIComponent(sku)); directProduct=j.product; renderDirect(directProduct);
  }catch(e){directProduct=null;$('#directResult').innerHTML='';$('#directError').textContent=e.message}
}
function directCondition(p){
  const raw=String(p.item_condition??'').trim();
  if(raw&&!/^\d+$/.test(raw)){
    const labels={new:'New',like_new:'Like New',very_good:'Very Good',good:'Good',acceptable:'Acceptable',refurbished:'Refurbished',salvage:'For Parts / Salvage',used:'Used'};
    return labels[raw.toLowerCase()]||raw.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  const id=String(p.ebay_item_condition_id??raw??'');
  return {'1000':'New','1500':'New Other','1750':'New With Defects','2000':'Certified Refurbished','2010':'Excellent - Refurbished','2020':'Very Good - Refurbished','2030':'Good - Refurbished','2500':'Seller Refurbished','3000':'Used','4000':'Very Good','5000':'Good','6000':'Acceptable','7000':'For Parts or Not Working'}[id]||id||'Unknown';
}
function renderDirect(p){
  const locs=(p.locations||[]);
  const rows=locs.length?locs.map((x,i)=>`<div class="card"><div class="meta"><div><b>Location:</b> ${esc(x.location||'NO LOCATION')}</div><div><b>Quantity at this location:</b> ${esc(x.quantity_available)}</div></div><label>Adjust quantity at ${esc(x.location||'this location')}</label><div class="row"><input id="directQty${i}" type="number" inputmode="numeric" min="0" value="${esc(x.quantity_available)}"><button onclick="updateDirectQty(${i})">Update Quantity</button></div></div>`).join(''):`<div class="card"><p>No inventory locations are currently assigned.</p><label>Location</label><input id="directNewLoc"><label>Quantity</label><input id="directNewQty" type="number" inputmode="numeric" min="0" value="0"><button onclick="addDirectLocation()">Set Quantity</button></div>`;
  $('#directResult').innerHTML=`<div class="card"><h2>${esc(p.sku)}</h2><div class="meta"><div><b>Location:</b> ${esc(locs.map(x=>x.location).filter(Boolean).join(', ')||'NO LOCATION')}</div><div><b>Title:</b> ${esc(p.title)}</div><div><b>Status:</b> ${esc(String(p.marketplace_status||'unknown').toUpperCase())} ${String(p.marketplace_status||'').toLowerCase()!=='active'?`<button class="secondary" onclick="activateDirectProduct()">Activate Item</button>`:''}</div><div><b>Quantity On Hand:</b> ${esc(p.quantity_on_hand)}</div><div><b>Quantity In Reserve:</b> ${esc(p.reserve_quantity)}</div><div><b>eBay Condition:</b> ${esc(directCondition(p))} - ${esc(p.item_remarks||'No Item Remarks')}</div></div></div>${rows}`;
}
window.updateDirectQty=async i=>{
  const row=directProduct.locations[i], qty=$(`#directQty${i}`).value;
  if(!confirm(`Change ${row.location} quantity from ${row.quantity_available} to ${qty}?`))return;
  try{await api(`/api/direct/product/${directProduct.id}/quantity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:row.location,quantity:qty})});await searchDirectSku()}catch(e){alert(e.message)}
};
window.addDirectLocation=async()=>{
  const loc=$('#directNewLoc').value.trim(),qty=$('#directNewQty').value;
  if(!loc)return alert('Enter a location.');
  if(!confirm(`Set ${loc} quantity to ${qty}?`))return;
  try{await api(`/api/direct/product/${directProduct.id}/quantity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:loc,quantity:qty})});await searchDirectSku()}catch(e){alert(e.message)}
};


$('#directUpcSearch').onclick=()=>searchDirectAlternate('upc');
$('#directTitleSearch').onclick=()=>searchDirectAlternate('title');
$('#directUpc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchDirectAlternate('upc')}});
$('#directTitle').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchDirectAlternate('title')}});
async function searchDirectAlternate(type){
  const q=(type==='upc'?$('#directUpc'):$('#directTitle')).value.trim();
  if(!q)return;
  $('#directAltError').textContent='';$('#directResult').innerHTML='';$('#directChoices').innerHTML='<div class="card">Searching SellerChamp…</div>';
  try{
    const j=await api(`/api/direct/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);
    const rows=j.results||[];
    if(!rows.length){$('#directChoices').innerHTML='';$('#directAltError').textContent='No matching SellerChamp products found.';return}
    if(rows.length===1){await chooseDirectProduct(rows[0].id);return}
    $('#directChoices').innerHTML=`<div class="card"><h3>${rows.length} matches — choose the correct item</h3>${rows.map(r=>`<div class="queue-row"><div><b>${esc(r.sku)}</b><br>${esc(r.title)}${r.upc?`<br><span class="hint">UPC: ${esc(r.upc)}</span>`:''}<br><span class="hint"><b>Status:</b> ${esc(String(r.marketplace_status||'unknown').toUpperCase())}</span><br><span class="hint">${esc(directCondition(r))} - ${esc(r.item_remarks||'No Item Remarks')}</span></div><button onclick="chooseDirectProduct('${r.id}')">Select</button></div>`).join('')}</div>`;
  }catch(e){$('#directChoices').innerHTML='';$('#directAltError').textContent=e.message}
}
window.chooseDirectProduct=async id=>{
  try{
    $('#directChoices').innerHTML='<div class="card">Loading product…</div>';
    const j=await api('/api/direct/product/'+encodeURIComponent(id));directProduct=j.product;$('#directChoices').innerHTML='';renderDirect(directProduct);
  }catch(e){$('#directChoices').innerHTML='';$('#directAltError').textContent=e.message}
};


window.activateDirectProduct=async()=>{
  if(!directProduct)return;
  if(!confirm(`Activate ${directProduct.sku} on eBay through SellerChamp?`))return;
  try{
    const btn=event?.target; if(btn){btn.disabled=true;btn.textContent='Activating…'}
    const j=await api(`/api/direct/product/${directProduct.id}/activate`,{method:'POST'});
    const refreshed=await api('/api/direct/product/'+encodeURIComponent(directProduct.id));
    directProduct=refreshed.product; renderDirect(directProduct);
    alert(`Activation request completed. Current SellerChamp status: ${String(j.marketplace_status||directProduct.marketplace_status||'unknown').toUpperCase()}.`);
  }catch(e){alert(e.message);renderDirect(directProduct)}
};
