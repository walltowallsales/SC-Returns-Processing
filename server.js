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
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const readDb = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '[]'); } catch { return []; } };
const writeDb = rows => { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2)); fs.renameSync(tmp, DB_FILE); };
const now = () => new Date().toISOString();
const digits = s => String(s || '').replace(/\D/g, '');
const formatOrder = s => { const d = digits(s); return d.length === 12 ? `${d.slice(0,2)}-${d.slice(2,7)}-${d.slice(7,12)}` : String(s || '').trim(); };
function token(){ const t = process.env.SELLERCHAMP_API_TOKEN; if(!t) throw new Error('SELLERCHAMP_API_TOKEN is not configured.'); return t; }
async function sc(endpoint, options={}){
  const res = await fetch(SC_BASE + endpoint, { ...options, headers: { Token: token(), 'Content-Type':'application/json', ...(options.headers||{}) } });
  const text = await res.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw:text }; }
  if(!res.ok) throw new Error(body?.error || body?.message || `SellerChamp returned ${res.status}`);
  return body;
}
const first = (o,...keys) => { for(const k of keys) if(o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const ebayUrl = p => { const id = first(p,'marketplace_id','ebay_item_id'); return id ? `https://www.ebay.com/itm/${encodeURIComponent(id)}` : (p?.marketplace_url || ''); };
const sellerChampUrl = p => p?.id ? `https://app.sellerchamp.com/products/${p.id}` : 'https://app.sellerchamp.com';

app.get('/api/config', (req,res)=>res.json({pinRequired:!!process.env.APP_PIN, duplicateReady:!!(process.env.SC_SHIP_FROM_ADDRESS_ID && process.env.SC_EBAY_TEMPLATE_ID && process.env.RETURN_APP_BASE_URL)}));
app.post('/api/pin', (req,res)=>res.json({ok:!process.env.APP_PIN || String(req.body.pin||'') === process.env.APP_PIN}));

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
  const rows = readDb().filter(r=>req.query.all==='1' || r.status!=='completed');
  rows.sort((a,b)=>(a.location||'').localeCompare(b.location||'',undefined,{numeric:true,sensitivity:'base'}) || a.created_at.localeCompare(b.created_at));
  res.json({returns:rows});
});
app.get('/api/returns/:id', (req,res)=>{ const r=readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).json({error:'Return not found'}); res.json({return:r}); });

function pdfText(doc,label,value){ doc.font('Helvetica-Bold').text(label,{continued:true}); doc.font('Helvetica').text(` ${value||''}`); }
app.get('/api/returns/:id/pdf', (req,res)=>{
  const r = readDb().find(x=>x.id===req.params.id); if(!r) return res.status(404).send('Return not found');
  res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="return-${r.order_number||r.id}.pdf"`);
  const doc = new PDFDocument({size:'LETTER',margin:36}); doc.pipe(res);
  doc.fontSize(20).font('Helvetica-Bold').text('RETURN PROCESSING SHEET',{align:'center'}).moveDown(.6);
  doc.fontSize(10); pdfText(doc,'Order:',r.order_number); pdfText(doc,'SKU:',r.sku); pdfText(doc,'Title:',r.title); pdfText(doc,'Qty Returned:',r.returned_qty); pdfText(doc,'Original Condition:',r.original_condition); pdfText(doc,'Observed Condition:',r.observed_condition);
  pdfText(doc,'Front-of-House Decision:', ({return_inventory:'RETURN TO NORMAL INVENTORY',reserve_inventory:'RETURN TO INVENTORY + RESERVE',duplicate_product:'CREATE SEPARATE PRODUCT'})[r.disposition] || r.disposition);
  doc.moveDown(.4).font('Helvetica-Bold').text('Instructions / Notes'); doc.font('Helvetica').text(r.notes||'None',{width:540}).moveDown(.7);
  const files = r.photos.slice(0,6).map(p=>path.join(UPLOAD_DIR,path.basename(p))).filter(fs.existsSync);
  if(files.length){
    doc.font('Helvetica-Bold').text('Return Photos').moveDown(.3); let x=36, y=doc.y, w=168, h=120;
    files.forEach((f,i)=>{ if(i===3){ y+=h+12; x=36; } else if(i>0 && i!==3) x+=w+12; try{ doc.image(f,x,y,{fit:[w,h],align:'center',valign:'center'}); }catch{} });
    doc.y = y+h+16;
  }
  if(doc.y>650) doc.addPage();
  doc.moveDown(.5).fontSize(12).font('Helvetica-Bold').text('ITEM LOCATION',{align:'center'}); doc.fontSize(34).text(r.location||'NO LOCATION',{align:'center'}); doc.end();
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

async function addAtLocation(product, inv, loc, qty){
  const row = inv.find(x=>String(x.location).toLowerCase()===String(loc).toLowerCase());
  if(row) return sc(`/api/products/${product.id}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:Number(row.quantity_available||0)+qty,delete_if_empty:row.delete_if_empty!==false,priority:row.priority||1}})});
  return sc(`/api/products/${product.id}/inventory_locations`,{method:'POST',body:JSON.stringify({inventory_location:{location:loc,quantity_available:qty,delete_if_empty:true,priority:1}})});
}
app.post('/api/returns/:id/add-inventory', async(req,res)=>{
  try{ const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'}); const r=db[idx], qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location; await addAtLocation(product,inv,loc,qty); r.status='completed'; r.updated_at=now(); r.history.push({at:now(),action:'inventory_added',details:`Added ${qty} at ${loc}`}); writeDb(db); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/add-reserve', async(req,res)=>{
  try{ const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'}); const r=db[idx], qty=Number(req.body.qty||r.returned_qty||1), {product,inv}=await getProductAndInventory(r), loc=req.body.location||r.location; await addAtLocation(product,inv,loc,qty); await sc(`/api/products/${product.id}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:Number(product.reserve_quantity||0)+qty,reserve_quantity_location:req.body.reserve_location||loc}})}); r.status='completed'; r.updated_at=now(); r.history.push({at:now(),action:'inventory_reserved',details:`Added ${qty} and increased reserve by ${qty}`}); writeDb(db); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/returns/:id/duplicate', async(req,res)=>{
  try{
    const db=readDb(), idx=db.findIndex(x=>x.id===req.params.id); if(idx<0)return res.status(404).json({error:'Return not found'}); const r=db[idx], {product}=await getProductAndInventory(r);
    const ship=process.env.SC_SHIP_FROM_ADDRESS_ID, template=process.env.SC_EBAY_TEMPLATE_ID, base=String(process.env.RETURN_APP_BASE_URL||'').replace(/\/$/,'');
    if(!ship||!template||!base) throw new Error('Duplicate listing setup is incomplete. Configure SC_SHIP_FROM_ADDRESS_ID, SC_EBAY_TEMPLATE_ID, and RETURN_APP_BASE_URL in Render.');
    const newSku=String(req.body.sku||'').trim(); if(!newSku) throw new Error('New SKU is required.');
    const attrs={sku:newSku,title:req.body.title||product.title,quantity:Number(req.body.qty||r.returned_qty||1),item_condition:req.body.item_condition||'good',item_remarks:req.body.item_remarks||r.notes||product.item_remarks||'',retail_price:Number(req.body.retail_price||product.retail_price||0),item_location:req.body.location||r.location,description:product.description||'',brand:product.brand||'',mpn:product.mpn||'',upc:product.upc||'',item_category:product.item_category||'',item_category_id:product.item_category_id||'',listing_format:product.listing_format||'fixed_price',listing_duration:product.listing_duration||'gtc',weight_in_pounds:product.weight_in_pounds||0,package_dimensions_length:product.package_dimensions_length||0,package_dimensions_width:product.package_dimensions_width||0,package_dimensions_height:product.package_dimensions_height||0,image_urls:r.photos.map(p=>base+p)};
    const payload={manifest:{name:`Return ${r.order_number} ${newSku}`,marketplace_account_id:r.marketplace_account_id,ship_from_address_id:ship,template_id:template,auto_submit:true,product_listings_attributes:[attrs]}};
    const created=await sc('/api/manifests',{method:'POST',body:JSON.stringify(payload)});
    r.status='completed'; r.updated_at=now(); r.history.push({at:now(),action:'duplicated',details:`Created new listing SKU ${newSku}`}); r.duplicate_result=created; writeDb(db); res.json({ok:true,result:created});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`SellerChamp Returns listening on ${PORT}`));
