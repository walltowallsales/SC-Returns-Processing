const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SC_BASE = 'https://app.sellerchamp.com';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'returns.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const readDb = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '[]'); } catch { return []; } };
const writeDb = rows => { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2)); fs.renameSync(tmp, DB_FILE); };
const now = () => new Date().toISOString();
const digits = s => String(s || '').replace(/\D/g, '');
const formatOrder = s => { const d = digits(s); return d.length === 12 ? `${d.slice(0,2)}-${d.slice(2,7)}-${d.slice(7,12)}` : String(s || '').trim(); };
const AUTH_COOKIE = 'sc_returns_auth';
const AUTH_MAX_AGE = 30 * 24 * 60 * 60; // 30 days on this browser/device
function parseCookies(req){
  const out={}; String(req.headers.cookie||'').split(';').forEach(part=>{ const i=part.indexOf('='); if(i>0) out[decodeURIComponent(part.slice(0,i).trim())]=decodeURIComponent(part.slice(i+1).trim()); }); return out;
}
function authSecret(){ return process.env.APP_PIN || ''; }
function makeAuthToken(){
  const exp=Math.floor(Date.now()/1000)+AUTH_MAX_AGE;
  const payload=String(exp);
  const sig=crypto.createHmac('sha256',authSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function authValid(req){
  if(!process.env.APP_PIN) return true;
  const tok=parseCookies(req)[AUTH_COOKIE]||'';
  const [exp,sig]=tok.split('.');
  if(!exp||!sig||Number(exp)<Math.floor(Date.now()/1000)) return false;
  const expected=crypto.createHmac('sha256',authSecret()).update(exp).digest('hex');
  try{return crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected));}catch{return false;}
}
function requirePin(req,res,next){ if(authValid(req)) return next(); return res.status(401).json({error:'PIN required.',pin_required:true}); }
function photoSignature(returnId,index,filename){
  const secret=process.env.SELLERCHAMP_API_TOKEN || authSecret() || 'returns-photo';
  return crypto.createHmac('sha256',secret).update(`${returnId}|${index}|${filename}`).digest('hex');
}
function token(){ const t = process.env.SELLERCHAMP_API_TOKEN; if(!t) throw new Error('SELLERCHAMP_API_TOKEN is not configured.'); return t; }
async function sc(endpoint, options={}){
  const res = await fetch(SC_BASE + endpoint, { ...options, headers: { Token: token(), 'Content-Type':'application/json', ...(options.headers||{}) } });
  const text = await res.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw:text }; }
  if(!res.ok) throw new Error(body?.error || body?.message || `SellerChamp returned ${res.status}`);
  return body;
}
const first = (o,...keys) => { for(const k of keys) if(o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const ebayUrl = p => { const id = first(p,'marketplace_id','ebay_item_id'); return id ? `https://www.ebay.com/itm/${encodeURIComponent(id)}` : (p?.marketplace_url || ''); };
const conditionName = v => {
  const raw=String(v??'').trim();
  const names={
    '1000':'New','1500':'New other (see details)','1750':'New with defects',
    '2000':'Certified refurbished','2010':'Excellent - Refurbished','2020':'Very Good - Refurbished',
    '2030':'Good - Refurbished','2500':'Seller refurbished','3000':'Used',
    '4000':'Very Good','5000':'Good','6000':'Acceptable','7000':'For parts or not working'
  };
  return names[raw] || raw || 'Unknown';
};
const sellerChampUrl = p => {
  if(!p?.sku) return 'https://app2.sellerchamp.com/products';
  const q=encodeURIComponent(p.sku);
  return `https://app2.sellerchamp.com/products?utf8=%E2%9C%93&listings_filter=all&product%5Bmarketplace_manually_removed%5D=false&product%5Bquery%5D=${q}&product%5Bquery_comparison%5D=&product%5Bquery_field%5D=&product%5Bstatus%5D=&product%5Bitem_condition%5D=all&per_page=50`;
};

app.get('/api/config', (req,res)=>res.json({pinRequired:!!process.env.APP_PIN, authenticated:authValid(req), duplicateReady:!!(process.env.SC_SHIP_FROM_ADDRESS_ID && process.env.SC_EBAY_TEMPLATE_ID && process.env.RETURN_APP_BASE_URL)}));
app.post('/api/pin', (req,res)=>{
  const ok=!process.env.APP_PIN || String(req.body.pin||'') === process.env.APP_PIN;
  if(ok && process.env.APP_PIN){
    res.setHeader('Set-Cookie',`${AUTH_COOKIE}=${encodeURIComponent(makeAuthToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}; Secure`);
  }
  res.json({ok});
});
app.get('/listing-photo/:returnId/:index', (req,res)=>{
  const r=readDb().find(x=>x.id===req.params.returnId); const i=Number(req.params.index);
  if(!r || !Number.isInteger(i) || i<0 || i>=r.photos.length) return res.status(404).send('Not found');
  const filename=path.basename(r.photos[i]); const expected=photoSignature(r.id,i,filename);
  const sig=String(req.query.sig||'');
  try{ if(!sig || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return res.status(403).send('Forbidden'); }catch{return res.status(403).send('Forbidden');}
  const file=path.join(UPLOAD_DIR,filename); if(!fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});
app.use('/api', requirePin);
app.use('/uploads', requirePin, express.static(UPLOAD_DIR));

app.get('/api/order/:orderNumber', async (req,res) => {
  try {
    const orderNumber = formatOrder(req.params.orderNumber);
    const found = await sc(`/api/orders?order_number=${encodeURIComponent(orderNumber)}&page=1&page_size=20`);
    const orders = found.orders || [];
    const order = orders.find(o=>o.order_number===orderNumber) || orders[0];
    if(!order) return res.status(404).json({error:'Order not found.'});
    const items = [];
    for(const item of (order.items || [])){
      let product = null;
      if(item.product_id){ try { product = (await sc(`/api/products/${item.product_id}`)).product; } catch {} }
      if(!product && item.sku){
        try {
          const p = await sc(`/api/products?sku=${encodeURIComponent(item.sku)}&marketplace_account_id=${encodeURIComponent(order.marketplace_account_id||'')}&page=1&page_size=20`);
          product = (p.products||[]).find(x=>x.sku===item.sku) || (p.products||[])[0] || null;
        } catch {}
      }
      let inv = [];
      if(product?.id){ try { inv = (await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations || []; } catch {} }
      const location = item.warehouse_location || product?.item_location || product?.bin_location || inv?.[0]?.location || '';
      items.push({...item, product, inventory_locations:inv, location, sellerchamp_url:sellerChampUrl(product), ebay_url:ebayUrl(product)});
    }
    res.json({order:{...order,items}});
  } catch(e){ res.status(500).json({error:e.message}); }
});

const storage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
  filename:(req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname||'').slice(0,8)||'.jpg'}`)
});
const upload = multer({storage, limits:{files:6,fileSize:12*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\//.test(file.mimetype))});

app.post('/api/returns', upload.array('photos',6), (req,res)=>{
  try {
    const record = {
      id:crypto.randomUUID(), created_at:now(), updated_at:now(), status:'awaiting_processing',
      order_number:formatOrder(req.body.order_number), order_id:req.body.order_id||'', marketplace_account_id:req.body.marketplace_account_id||'', marketplace:req.body.marketplace||'',
      order_item_id:req.body.order_item_id||'', sku:req.body.sku||'', title:req.body.title||'', product_id:req.body.product_id||'', marketplace_id:req.body.marketplace_id||'',
      original_condition:req.body.original_condition||'', item_remarks:req.body.item_remarks||'', returned_qty:Number(req.body.returned_qty||1), location:req.body.location||'',
      notes:req.body.notes||'', disposition:req.body.disposition||'return_inventory', observed_condition:req.body.observed_condition||'',
      photos:(req.files||[]).map(f=>`/uploads/${f.filename}`), sellerchamp_url:req.body.sellerchamp_url||'', ebay_url:req.body.ebay_url||'',
      history:[{at:now(),action:'received',details:`Front of house chose ${req.body.disposition||'return_inventory'}`}]
    };
    const db = readDb(); db.push(record); writeDb(db);
    res.json({ok:true,record,pdf_url:`/api/returns/${record.id}/pdf`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/returns', (req,res)=>{
  const rows = readDb().filter(r=>req.query.all==='1' || !['completed','archived'].includes(r.status));
  rows.sort((a,b)=>(a.location||'').localeCompare(b.location||'',undefined,{numeric:true,sensitivity:'base'}) || a.created_at.localeCompare(b.created_at));
  res.json({returns:rows});
});

app.delete('/api/returns/:id/delete', (req,res)=>{
  try{
    if(String(req.body?.pin||'') !== '8880') return res.status(403).json({error:'Incorrect delete PIN'});
    const db=readDb(), r=db.find(x=>x.id===req.params.id);
    if(!r) return res.status(404).json({error:'Return not found'});
    if(['archived','completed'].includes(r.status)) return res.status(400).json({error:'Only records in Process Returns can be deleted here'});
    for(const photo of (r.photos||[])){
      const file=path.join(UPLOAD_DIR,path.basename(photo));
      try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}
    }
    writeDb(db.filter(x=>x.id!==req.params.id));
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
});

app.delete('/api/returns/archive/purge-older-than-60-days', (req,res)=>{
  try{
    const db=readDb(), cutoff=Date.now()-(60*24*60*60*1000);
    const doomed=db.filter(r=>r.status==='archived'&&r.archived_at&&new Date(r.archived_at).getTime()<cutoff);
    for(const r of doomed) for(const photo of (r.photos||[])){const file=path.join(UPLOAD_DIR,path.basename(photo));try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}}
    const ids=new Set(doomed.map(r=>r.id)); writeDb(db.filter(r=>!ids.has(r.id)));
    res.json({ok:true,deleted:doomed.length,cutoff:new Date(cutoff).toISOString()});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/returns/:id', (req,res)=>{ const r=readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).json({error:'Return not found'}); res.json({return:r}); });

function pdfText(doc,label,value){ doc.font('Helvetica-Bold').text(label,{continued:true}); doc.font('Helvetica').text(` ${value||''}`); }
app.get('/api/returns/:id/pdf', (req,res)=>{
  const r = readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).send('Return not found');
  res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="return-${r.order_number||r.id}.pdf"`);
  const doc = new PDFDocument({size:'LETTER',margin:36}); doc.pipe(res);
  doc.font('Helvetica-Bold');
  let titleSize=40;
  while(titleSize>10){
    doc.fontSize(titleSize);
    if(doc.widthOfString('RETURN PROCESSING SHEET') <= 540) break;
    titleSize--;
  }
  doc.fontSize(titleSize).text('RETURN PROCESSING SHEET',{align:'center',lineBreak:false}).moveDown(.6);
  doc.fontSize(20); pdfText(doc,'Order:',r.order_number); pdfText(doc,'SKU:',r.sku); pdfText(doc,'Title:',r.title); pdfText(doc,'Qty Returned:',r.returned_qty); pdfText(doc,'Original Condition:',conditionName(r.original_condition)); pdfText(doc,'Observed Condition:',r.observed_condition);
  doc.moveDown(.6);
  pdfText(doc,'Front-of-House Decision:', ({return_inventory:'RETURN TO NORMAL INVENTORY',reserve_inventory:'RETURN TO INVENTORY + RESERVE',duplicate_product:'CREATE SEPARATE PRODUCT'})[r.disposition] || r.disposition);
  doc.moveDown(.4).font('Helvetica-Bold').text('Instructions / Notes'); doc.font('Helvetica-Bold').text(r.notes||'None',{width:540}).moveDown(.7);
  const files = r.photos.slice(0,6).map(p=>path.join(UPLOAD_DIR,path.basename(p))).filter(fs.existsSync);
  if(files.length){
    doc.font('Helvetica-Bold').text('Return Photos').moveDown(.3); let x=36, y=doc.y, w=168, h=120;
    files.forEach((f,i)=>{ if(i===3){ y+=h+12; x=36; } else if(i>0 && i!==3) x+=w+12; try{ doc.image(f,x,y,{fit:[w,h],align:'center',valign:'center'}); }catch{} });
    doc.y = y+h+16;
  }
  if(doc.y>650) doc.addPage();
  doc.moveDown(.5).fontSize(24).font('Helvetica-Bold').text('ITEM LOCATION',{align:'center'}); doc.fontSize(68).text(r.location||'NO LOCATION',{align:'center'}); doc.end();
});

async function getProductAndInventory(r){
  let product = null;
  if(r.product_id) try { product=(await sc(`/api/products/${r.product_id}`)).product; } catch {}
  if(!product && r.sku){ const p=await sc(`/api/products?sku=${encodeURIComponent(r.sku)}&marketplace_account_id=${encodeURIComponent(r.marketplace_account_id||'')}&page=1&page_size=20`); product=(p.products||[]).find(x=>x.sku===r.sku)||(p.products||[])[0]; }
  if(!product) throw new Error('Could not find matching SellerChamp product.');
  const inv=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[];
  return {product,inv};
}
app.get('/api/returns/:id/inventory', async(req,res)=>{ try{ const r=readDb().find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'}); res.json(await getProductAndInventory(r)); }catch(e){res.status(500).json({error:e.message});} });

function archiveRecord(r, action, details){
  r.status='archived'; r.archived_at=now(); r.updated_at=now();
  r.history.push({at:now(),action,details});
}
async function freshProduct(productId){
  const j=await sc(`/api/products/${productId}`); return j.product||j;
}
async function addAtLocation(product, inv, loc, qty){
  const row = inv.find(x=>String(x.location).toLowerCase()===String(loc).toLowerCase());
  if(row) return sc(`/api/products/${product.id}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:Number(row.quantity_available||0)+qty,delete_if_empty:row.delete_if_empty!==false,priority:row.priority||1}})});
  return sc(`/api/products/${product.id}/inventory_locations`,{method:'POST',body:JSON.stringify({inventory_location:{location:loc,quantity_available:qty,delete_if_empty:true,priority:1}})});
}
app.post('/api/returns/:id/add-inventory', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx];
    if(r.status==='inventory_added_pending_listing'){
      const {product}=await getProductAndInventory(r);
      return res.json({ok:true,already_added:true,marketplace_status:String(product.marketplace_status||'unknown').toLowerCase(),product_id:product.id});
    }
    if(['completed','archived'].includes(r.status)) return res.status(409).json({error:'This return has already been processed.'});
    const qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location;
    await addAtLocation(product,inv,loc,qty);
    const refreshed=await freshProduct(product.id);
    const marketplaceStatus=String(refreshed.marketplace_status||product.marketplace_status||'unknown').toLowerCase();
    r.inventory_result={at:now(),qty,location:loc,product_id:product.id,marketplace_status:marketplaceStatus};
    r.updated_at=now();
    r.history.push({at:now(),action:'inventory_added',details:`Added ${qty} at ${loc}; marketplace status ${marketplaceStatus}`});
    if(marketplaceStatus==='active'){
      archiveRecord(r,'archived','Inventory returned; eBay listing already active.');
    }else{
      r.status='inventory_added_pending_listing';
    }
    writeDb(db);
    res.json({ok:true,marketplace_status:marketplaceStatus,archived:r.status==='archived',product_id:product.id,ebay_url:ebayUrl(refreshed)||r.ebay_url||''});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/relist-and-archive', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx]; if(r.status!=='inventory_added_pending_listing') return res.status(409).json({error:'Inventory must be added before relisting.'});
    const {product}=await getProductAndInventory(r);
    await sc(`/api/products/${product.id}?relist=true`,{method:'PUT',body:JSON.stringify({product:{}})});
    let refreshed=null; try{refreshed=await freshProduct(product.id)}catch{}
    archiveRecord(r,'relisted_and_archived',`Relist requested for ${r.sku}. Marketplace status after request: ${refreshed?.marketplace_status||'pending'}`);
    writeDb(db); res.json({ok:true,marketplace_status:refreshed?.marketplace_status||'pending'});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/archive-inactive', (req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx]; if(r.status!=='inventory_added_pending_listing') return res.status(409).json({error:'This return is not waiting for an eBay listing decision.'});
    archiveRecord(r,'archived_inactive','Inventory returned; eBay listing intentionally left inactive.'); writeDb(db); res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/add-reserve', async(req,res)=>{
  try{ const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'}); const r=db[idx], qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location; await addAtLocation(product,inv,loc,qty); await sc(`/api/products/${product.id}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:Number(product.reserve_quantity||0)+qty,reserve_quantity_location:req.body.reserve_location||loc}})}); archiveRecord(r,'inventory_reserved',`Added ${qty} and increased reserve by ${qty}`); writeDb(db); res.json({ok:true,archived:true}); }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/duplicate', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'}); const r=db[idx], {product}=await getProductAndInventory(r);
    const ship=process.env.SC_SHIP_FROM_ADDRESS_ID, template=process.env.SC_EBAY_TEMPLATE_ID, base=String(process.env.RETURN_APP_BASE_URL||'').replace(/\/$/,'');
    if(!ship||!template||!base) throw new Error('Duplicate listing setup is incomplete. Configure SC_SHIP_FROM_ADDRESS_ID, SC_EBAY_TEMPLATE_ID, and RETURN_APP_BASE_URL in Render.');
    const newSku=String(req.body.sku||'').trim(); if(!newSku) throw new Error('New SKU is required.');
    const attrs={sku:newSku,title:req.body.title||product.title,quantity:Number(req.body.qty||r.returned_qty||1),item_condition:req.body.item_condition||'good',item_remarks:req.body.item_remarks||r.notes||product.item_remarks||'',retail_price:Number(req.body.retail_price||product.retail_price||0),item_location:req.body.location||r.location,description:product.description||'',brand:product.brand||'',mpn:product.mpn||'',upc:product.upc||'',item_category:product.item_category||'',item_category_id:product.item_category_id||'',listing_format:product.listing_format||'fixed_price',listing_duration:product.listing_duration||'gtc',weight_in_pounds:product.weight_in_pounds||0,package_dimensions_length:product.package_dimensions_length||0,package_dimensions_width:product.package_dimensions_width||0,package_dimensions_height:product.package_dimensions_height||0,image_urls:r.photos.map((p,i)=>`${base}/listing-photo/${encodeURIComponent(r.id)}/${i}?sig=${photoSignature(r.id,i,path.basename(p))}`)};
    const payload={manifest:{name:`Return ${r.order_number} ${newSku}`,marketplace_account_id:r.marketplace_account_id,ship_from_address_id:ship,template_id:template,auto_submit:true,product_listings_attributes:[attrs]}};
    const created=await sc('/api/manifests',{method:'POST',body:JSON.stringify(payload)});
    r.duplicate_result=created; archiveRecord(r,'duplicated',`Created new listing SKU ${newSku}`); writeDb(db); res.json({ok:true,archived:true,result:created});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`SellerChamp Returns listening on ${PORT}`));
