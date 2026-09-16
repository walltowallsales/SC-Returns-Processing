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
      if(product?.id){
        try{
          const full=await sc(`/api/products/${product.id}`);
          product=full.product||full||product;
        }catch{}
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
    const incomingOrder=formatOrder(req.body.order_number);
    const db=readDb();
    const duplicate=db.find(r=>formatOrder(r.order_number)===incomingOrder);
    if(duplicate){
      for(const f of (req.files||[])){try{if(fs.existsSync(f.path))fs.unlinkSync(f.path)}catch{}}
      return res.status(409).json({error:`RETURN ALREADY PROCESSED — Order ${incomingOrder} already exists (${duplicate.status}).`,duplicate:{id:duplicate.id,status:duplicate.status,sku:duplicate.sku,location:duplicate.location,created_at:duplicate.created_at,archived_at:duplicate.archived_at||''}});
    }
    const record = {
      id:crypto.randomUUID(), created_at:now(), updated_at:now(), status:'awaiting_processing',
      order_number:incomingOrder, order_id:req.body.order_id||'', marketplace_account_id:req.body.marketplace_account_id||'', marketplace:req.body.marketplace||'',
      order_item_id:req.body.order_item_id||'', sku:req.body.sku||'', title:req.body.title||'', product_id:req.body.product_id||'', marketplace_id:req.body.marketplace_id||'',
      original_condition:req.body.original_condition||'', item_remarks:req.body.item_remarks||'', returned_qty:Number(req.body.returned_qty||1), location:req.body.location||'',
      notes:req.body.notes||'', disposition:req.body.disposition||'return_inventory', observed_condition:req.body.observed_condition||'',
      photos:(req.files||[]).map(f=>`/uploads/${f.filename}`), sellerchamp_url:req.body.sellerchamp_url||'', ebay_url:req.body.ebay_url||'',
      history:[{at:now(),action:'received',details:`Front of house chose ${req.body.disposition||'return_inventory'}`}]
    };
    db.push(record); writeDb(db);
    res.json({ok:true,record,pdf_url:`/api/returns/${record.id}/pdf`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/direct/search', async(req,res)=>{
  try{
    const type=String(req.query.type||'').toLowerCase(), q=String(req.query.q||'').trim();
    if(!q||!['upc','title'].includes(type))return res.status(400).json({error:'Enter a search value'});
    let products=[];
    if(type==='upc'){
      const found=await sc(`/api/products?upc=${encodeURIComponent(q)}&page=1&page_size=100`);
      products=found.products||[];
      if(!products.length){try{const f=await sc(`/api/products?query=${encodeURIComponent(q)}&page=1&page_size=100`);products=f.products||[]}catch{}}
      const digits=q.replace(/\D/g,'');
      products=products.filter(p=>String(p.upc||p.product_upc||p.barcode||'').replace(/\D/g,'')===digits || !String(p.upc||p.product_upc||p.barcode||''));
    }else{
      // Do not depend on a SellerChamp "title=" API filter. Search the product catalog
      // page-by-page and perform a case-insensitive title match here.
      const words=q.toLowerCase().split(/\s+/).filter(Boolean);
      for(let page=1;page<=20 && products.length<50;page++){
        const f=await sc(`/api/products?page=${page}&page_size=100`);
        const batch=f.products||[];
        products.push(...batch.filter(p=>{
          const title=String(p.title||'').toLowerCase();
          return words.every(w=>title.includes(w));
        }));
        if(batch.length<100)break;
      }
    }
    const results=products.slice(0,50).map(p=>({id:p.id,sku:p.sku||'',title:p.title||'',upc:p.upc||p.product_upc||p.barcode||'',item_condition:p.item_condition??'',ebay_item_condition_id:p.ebay_item_condition_id??p.item_condition_id??'',item_remarks:p.item_remarks||'',marketplace_status:String(p.marketplace_status||p.status||'unknown').toLowerCase()}));
    res.json({results});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/direct/product/:productId', async(req,res)=>{
  try{
    let product; const full=await sc(`/api/products/${req.params.productId}`); product=full.product||full;
    let inv=[]; try{inv=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[]}catch{}
    const locations=inv.map(x=>({id:x.id,location:x.location||'',quantity_available:Number(x.quantity_available||0),priority:x.priority||1,delete_if_empty:x.delete_if_empty!==false}));
    res.json({product:{id:product.id,sku:product.sku,title:product.title||'',item_condition:product.item_condition??'',ebay_item_condition_id:product.ebay_item_condition_id??product.item_condition_id??'',item_remarks:product.item_remarks||'',reserve_quantity:Number(product.reserve_quantity||0),locations,quantity_on_hand:locations.reduce((n,x)=>n+x.quantity_available,0),marketplace_status:String(product.marketplace_status||product.status||'unknown').toLowerCase()}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/direct/sku/:sku', async(req,res)=>{
  try{
    const sku=String(req.params.sku||'').trim(); if(!sku)return res.status(400).json({error:'Enter a SKU'});
    const found=await sc(`/api/products?sku=${encodeURIComponent(sku)}&page=1&page_size=50`);
    let product=(found.products||[]).find(x=>String(x.sku).toLowerCase()===sku.toLowerCase())||(found.products||[])[0];
    if(!product)return res.status(404).json({error:'SKU not found in SellerChamp'});
    try{const full=await sc(`/api/products/${product.id}`);product=full.product||full||product}catch{}
    let inv=[]; try{inv=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[]}catch{}
    const locations=inv.map(x=>({id:x.id,location:x.location||'',quantity_available:Number(x.quantity_available||0),priority:x.priority||1,delete_if_empty:x.delete_if_empty!==false}));
    const qtyOnHand=locations.reduce((n,x)=>n+x.quantity_available,0);
    res.json({product:{id:product.id,sku:product.sku,title:product.title||'',item_condition:product.item_condition??'',ebay_item_condition_id:product.ebay_item_condition_id??product.item_condition_id??'',item_remarks:product.item_remarks||'',reserve_quantity:Number(product.reserve_quantity||0),reserve_quantity_location:product.reserve_quantity_location||'',locations,quantity_on_hand:qtyOnHand,marketplace_status:String(product.marketplace_status||product.status||'unknown').toLowerCase()}});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/direct/product/:productId/activate', async(req,res)=>{
  try{
    const productId=req.params.productId;
    await sc(`/api/products/${productId}/relist`,{method:'POST'});
    const refreshed=await freshProduct(productId);
    res.json({ok:true,marketplace_status:String(refreshed.marketplace_status||refreshed.status||'unknown').toLowerCase()});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/direct/product/:productId/quantity', async(req,res)=>{
  try{
    const productId=req.params.productId, loc=String(req.body.location||'').trim(), qty=Number(req.body.quantity);
    if(!loc)return res.status(400).json({error:'Location is required'});
    if(!Number.isFinite(qty)||qty<0)return res.status(400).json({error:'Enter a valid quantity of 0 or more'});
    const inv=(await sc(`/api/products/${productId}/inventory_locations`)).inventory_locations||[];
    const row=inv.find(x=>String(x.location||'').toLowerCase()===loc.toLowerCase());
    if(row) await sc(`/api/products/${productId}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:qty,delete_if_empty:row.delete_if_empty!==false,priority:row.priority||1}})});
    else await sc(`/api/products/${productId}/inventory_locations`,{method:'POST',body:JSON.stringify({inventory_location:{location:loc,quantity_available:qty,delete_if_empty:true,priority:1}})});
    res.json({ok:true,location:loc,quantity_available:qty});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/returns/check-order/:orderNumber', (req,res)=>{
  const order=formatOrder(req.params.orderNumber);
  const r=readDb().find(x=>formatOrder(x.order_number)===order);
  res.json({exists:!!r,record:r?{id:r.id,status:r.status,sku:r.sku,title:r.title,location:r.location,created_at:r.created_at,archived_at:r.archived_at||''}:null});
});

app.get('/api/returns', (req,res)=>{
  const rows = readDb().filter(r=>req.query.all==='1' || !['completed','archived'].includes(r.status));
  rows.sort((a,b)=>(a.location||'').localeCompare(b.location||'',undefined,{numeric:true,sensitivity:'base'}) || a.created_at.localeCompare(b.created_at));
  res.json({returns:rows});
});

app.delete('/api/returns/:id/delete', (req,res)=>{
  try{
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

app.delete('/api/returns/:id/archive-delete', (req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id);
    if(!r)return res.status(404).json({error:'Return not found'});
    if(r.status!=='archived')return res.status(400).json({error:'Only archived returns can be deleted here'});
    for(const photo of (r.photos||[])){const file=path.join(UPLOAD_DIR,path.basename(photo));try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}}
    writeDb(db.filter(x=>x.id!==req.params.id));
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/returns/:id/restore-to-process', (req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id);
    if(!r)return res.status(404).json({error:'Return not found'});
    if(r.status!=='archived')return res.status(400).json({error:'Only archived returns can be moved back'});
    r.status='awaiting_processing'; r.updated_at=now(); r.archived_at='';
    r.history=r.history||[]; r.history.push({at:now(),action:'restored_to_process',details:'Moved from Archived back to Process Returns'});
    writeDb(db); res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/returns/:id', (req,res)=>{ const r=readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).json({error:'Return not found'}); res.json({return:r}); });

function pdfText(doc,label,value){ doc.font('Helvetica-Bold').text(label,{continued:true}); doc.font('Helvetica').text(` ${value||''}`); }
function pdfUnderlinedText(doc,label,value){
  const y=doc.y, x=doc.x, text=`${label} ${value||''}`;
  doc.font('Helvetica').text(text);
  const w=Math.min(doc.widthOfString(text),540);
  doc.moveTo(x,y+doc.currentLineHeight()).lineTo(x+w,y+doc.currentLineHeight()).stroke();
}
app.get('/api/returns/:id/pdf', (req,res)=>{
  const r = readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).send('Return not found');
  res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="return-${r.order_number||r.id}.pdf"`);
  const doc = new PDFDocument({size:'LETTER',margin:36}); doc.pipe(res);
  // Keep the title on one line without using lineBreak:false, which changes PDFKit's text cursor.
  doc.font('Helvetica-Bold').fontSize(32).text('RETURN PROCESSING SHEET',36,36,{width:540,align:'center'});
  doc.x=36;
  doc.y=82;
  doc.x=36; doc.fontSize(20); pdfText(doc,'Order:',r.order_number); pdfText(doc,'SKU:',r.sku); pdfText(doc,'Title:',r.title); pdfText(doc,'Qty Returned:',r.returned_qty); pdfText(doc,'Original Condition:',conditionName(r.original_condition)); pdfText(doc,'Original Item Remarks Description:',r.item_remarks||'');
  doc.moveDown(.6);
  doc.font('Helvetica-Bold').text('Observed Condition:',{continued:true});
  const obsX=doc.x, obsY=doc.y, obsText=` ${r.observed_condition||''}`;
  doc.font('Helvetica').text(obsText);
  const obsW=Math.min(doc.widthOfString(obsText),Math.max(0,576-obsX));
  doc.moveTo(obsX,obsY+doc.currentLineHeight()).lineTo(obsX+obsW,obsY+doc.currentLineHeight()).stroke();
  doc.moveDown(.6);
  pdfText(doc,'Decision:', ({return_inventory:'RETURN TO NORMAL INVENTORY',reserve_inventory:'RETURN TO INVENTORY + RESERVE',duplicate_product:'CREATE SEPARATE PRODUCT'})[r.disposition] || r.disposition);
  doc.moveDown(.4).font('Helvetica-Bold').text('Instructions:',{continued:true});
  doc.font('Helvetica').text(` ${r.notes||'None'}`).moveDown(.7);
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
async function cleanupZeroLocationsAfterMove(product, keepLocation){
  const inv=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[];
  const updated=[], failed=[];
  for(const row of inv){
    if(String(row.location||'').toLowerCase()===String(keepLocation||'').toLowerCase()) continue;
    if(Number(row.quantity_available||0)!==0) continue;
    try{
      // Do not attempt to remove the location. Only mark an empty location so SellerChamp
      // may remove it later if/when its own delete-if-empty behavior is triggered.
      await sc(`/api/products/${product.id}/inventory_locations/${row.id}`,{
        method:'PUT',
        body:JSON.stringify({inventory_location:{
          location:row.location,
          quantity_available:0,
          delete_if_empty:true,
          priority:row.priority||1
        }})
      });
      updated.push(row.location||'');
    }catch{failed.push(row.location||'')}
  }
  return {removed:[],failed,results:updated.map(location=>({location,method:'delete_if_empty set to true',removed:false})),delete_if_empty_updated:updated};
}

app.get('/api/returns/:id/listing-status', async(req,res)=>{
  try{
    const r=readDb().find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'});
    const {product}=await getProductAndInventory(r);
    const refreshed=await freshProduct(product.id);
    res.json({marketplace_status:String(refreshed.marketplace_status||product.marketplace_status||'unknown').toLowerCase(),product_id:product.id,ebay_url:ebayUrl(refreshed)||r.ebay_url||''});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/returns/:id/add-inventory', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx];
    if(['completed','archived'].includes(r.status)) return res.status(409).json({error:'This return has already been processed.'});
    const qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location;
    const beforeRow=inv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    const beforeQty=Number(beforeRow?.quantity_available||0);
    await addAtLocation(product,inv,loc,qty);
    const refreshed=await freshProduct(product.id);
    const marketplaceStatus=String(refreshed.marketplace_status||product.marketplace_status||'unknown').toLowerCase();
    r.inventory_result={at:now(),qty,location:loc,product_id:product.id,marketplace_status:marketplaceStatus};
    r.updated_at=now();
    r.history.push({at:now(),action:'inventory_added',details:`Added ${qty} at ${loc}; marketplace status ${marketplaceStatus}`});
    r.status='inventory_added_pending_listing';
    const after=await getProductAndInventory(r);
    const afterRow=after.inv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    const currentQty=Number(afterRow?.quantity_available||0);
    const expectedQty=beforeQty+qty;
    r.inventory_result.quantity_available=currentQty;
    r.inventory_result.before_quantity=beforeQty;
    r.inventory_result.expected_quantity=expectedQty;
    writeDb(db);
    if(!afterRow || currentQty!==expectedQty){
      return res.status(502).json({error:`SellerChamp did not change ${loc} as expected. Before: ${beforeQty}. Added: ${qty}. Expected: ${expectedQty}. SellerChamp now reports: ${currentQty}. The return remains in Process Returns.`,before_quantity:beforeQty,expected_quantity:expectedQty,quantity_available:currentQty,location:loc});
    }
    let cleanup={removed:[],failed:[]};
    try{cleanup=await cleanupZeroLocationsAfterMove(product,loc)}catch{}
    if(cleanup.removed.length) r.history.push({at:now(),action:'zero_locations_removed',details:`Removed zero-quantity locations: ${cleanup.removed.join(', ')}`});
    writeDb(db);
    res.json({ok:true,marketplace_status:marketplaceStatus,archived:false,product_id:product.id,ebay_url:ebayUrl(refreshed)||r.ebay_url||'',location:loc,quantity_available:currentQty,before_quantity:beforeQty,expected_quantity:expectedQty,removed_zero_locations:cleanup.removed,failed_zero_locations:cleanup.failed,cleanup_results:cleanup.results,delete_if_empty_updated:cleanup.delete_if_empty_updated||[]});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/set-inventory-quantity', async(req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'});
    const qty=Number(req.body.quantity);
    if(!Number.isFinite(qty)||qty<0)return res.status(400).json({error:'Enter a valid quantity of 0 or more.'});
    const {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location;
    const row=inv.find(x=>String(x.location).toLowerCase()===String(loc).toLowerCase());
    if(row) await sc(`/api/products/${product.id}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:qty,delete_if_empty:row.delete_if_empty!==false,priority:row.priority||1}})});
    else await sc(`/api/products/${product.id}/inventory_locations`,{method:'POST',body:JSON.stringify({inventory_location:{location:loc,quantity_available:qty,delete_if_empty:true,priority:1}})});
    r.updated_at=now(); r.history=r.history||[]; r.history.push({at:now(),action:'inventory_quantity_corrected',details:`Set ${loc} quantity to ${qty}`}); writeDb(db);
    res.json({ok:true,quantity_available:qty,location:loc});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/returns/:id/archive-active', (req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'});
    if(r.status!=='inventory_added_pending_listing')return res.status(409).json({error:'Inventory must be added first.'});
    archiveRecord(r,'archived','Inventory returned; eBay listing active; quantity reviewed.'); writeDb(db); res.json({ok:true,sku:r.sku||''});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/returns/:id/relist-and-archive', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx]; if(r.status!=='inventory_added_pending_listing') return res.status(409).json({error:'Inventory must be added before relisting.'});
    const {product}=await getProductAndInventory(r);

    // SellerChamp's own UI queues a relist and explicitly says it may take a few minutes.
    // Submit the same documented bulk relist request. A successful API response means the
    // relist was accepted/queued; it does NOT mean marketplace_status changes immediately.
    let relistResponse;
    try{
      relistResponse=await sc('/api/products/bulk_update',{
        method:'PUT',
        body:JSON.stringify({products:[{id:product.id}],relist:true})
      });
    }catch(e){
      r.updated_at=now(); r.history=r.history||[];
      r.history.push({at:now(),action:'relist_api_error',details:String(e.message||e)});
      writeDb(db);
      return res.status(502).json({error:`SellerChamp rejected the relist request: ${e.message||e}. The return was NOT archived.`});
    }

    let immediateStatus='unknown';
    try{
      const refreshed=await freshProduct(product.id);
      immediateStatus=String(refreshed?.marketplace_status||refreshed?.status||'unknown').toLowerCase();
    }catch{}

    archiveRecord(r,'relist_queued_and_archived',`SellerChamp accepted the relist queue request for ${r.sku}. Immediate status: ${immediateStatus}. SellerChamp notes relisting may take a few minutes.`);
    writeDb(db);
    res.json({ok:true,relist_queued:true,marketplace_status:immediateStatus,archived:true,sku:r.sku||'',sellerchamp_response:relistResponse});
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
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Return not found'});
    const r=db[idx]; if(['completed','archived'].includes(r.status))return res.status(409).json({error:'This return has already been processed.'});
    const qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location;
    const beforeRow=inv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    const beforeOnHand=Number(beforeRow?.quantity_available||0);
    const beforeReserve=Number(product.reserve_quantity||0);
    await addAtLocation(product,inv,loc,qty);
    const requestedReserve=beforeReserve+qty;
    await sc(`/api/products/${product.id}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:requestedReserve,reserve_quantity_location:req.body.reserve_location||loc}})});
    const verified=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[];
    const row=verified.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    const onHand=Number(row?.quantity_available||0);
    const verifiedProduct=await freshProduct(product.id);
    const verifiedReserve=Number(verifiedProduct?.reserve_quantity||0);
    const expectedOnHand=beforeOnHand+qty, expectedReserve=beforeReserve+qty;
    r.status='reserve_added_pending_review'; r.updated_at=now(); r.reserve_result={location:loc,quantity_added:qty,before_on_hand:beforeOnHand,quantity_available:onHand,before_reserve:beforeReserve,reserve_quantity:verifiedReserve,expected_on_hand:expectedOnHand,expected_reserve:expectedReserve};
    r.history=r.history||[]; r.history.push({at:now(),action:'reserve_added_pending_review',details:`Added ${qty} at ${loc}. On hand ${beforeOnHand} → ${onHand}; reserve ${beforeReserve} → ${verifiedReserve}. Awaiting quantity review.`});
    writeDb(db);
    res.json({ok:true,archived:false,sku:r.sku||'',title:r.title||'',location:loc,quantity_added:qty,before_on_hand:beforeOnHand,quantity_available:onHand,before_reserve:beforeReserve,reserve_quantity:verifiedReserve,expected_on_hand:expectedOnHand,expected_reserve:expectedReserve,on_hand_verified:onHand===expectedOnHand,reserve_verified:verifiedReserve===expectedReserve});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/returns/:id/set-reserve-quantities', async(req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'});
    if(r.status!=='reserve_added_pending_review')return res.status(409).json({error:'Reserve inventory must be added first.'});
    const {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.reserve_result?.location||r.location;
    const onHand=Math.max(0,Number(req.body.quantity_available||0)), reserve=Math.max(0,Number(req.body.reserve_quantity||0));
    const row=inv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    if(row) await sc(`/api/products/${product.id}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:loc,quantity_available:onHand,delete_if_empty:true,priority:row.priority||1}})});
    else await sc(`/api/products/${product.id}/inventory_locations`,{method:'POST',body:JSON.stringify({inventory_location:{location:loc,quantity_available:onHand,delete_if_empty:true,priority:1}})});
    await sc(`/api/products/${product.id}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:reserve,reserve_quantity_location:loc}})});
    const verifyInv=(await sc(`/api/products/${product.id}/inventory_locations`)).inventory_locations||[];
    const verifyRow=verifyInv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());
    const verifyProduct=await freshProduct(product.id);
    const actualOnHand=Number(verifyRow?.quantity_available||0), actualReserve=Number(verifyProduct?.reserve_quantity||0);
    r.reserve_result={...(r.reserve_result||{}),location:loc,quantity_available:actualOnHand,reserve_quantity:actualReserve};
    r.updated_at=now(); r.history.push({at:now(),action:'reserve_quantities_corrected',details:`Set on hand to ${actualOnHand}; reserve to ${actualReserve}`}); writeDb(db);
    res.json({ok:true,location:loc,quantity_available:actualOnHand,reserve_quantity:actualReserve});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/returns/:id/archive-reserve', (req,res)=>{
  try{
    const db=readDb(), r=db.find(x=>x.id===req.params.id); if(!r)return res.status(404).json({error:'Return not found'});
    if(r.status!=='reserve_added_pending_review')return res.status(409).json({error:'Reserve quantities must be reviewed first.'});
    const loc=r.reserve_result?.location||r.location;
    archiveRecord(r,'inventory_reserved','Inventory and reserve quantities reviewed and confirmed.'); writeDb(db);
    res.json({ok:true,archived:true,sku:r.sku||'',title:r.title||'',location:loc});
  }catch(e){res.status(500).json({error:e.message});}
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
