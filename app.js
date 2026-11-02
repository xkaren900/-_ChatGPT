/* GitHub UI, backed by separate parts / locations / stock collections. */
const typeName={room:'房間',cabinet:'櫃子',box:'箱子',item:'一般物品'};
const typeIcon={room:'⌂',cabinet:'▥',box:'▣',item:'◆'};
const nav=[['home','⌂','首頁'],['search','⌕','查詢'],['add','＋','新增'],['move','↪','移動'],['locations','☷','位置']];
let state=WarehouseCore.empty(),items=[],current='home',scanCallback=null,stream=null,detector=null,detecting=false,detailGeneration=0;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const byId=id=>items.find(x=>x.id===id), partById=id=>state.parts.find(x=>x.id===id), locById=id=>state.locations.find(x=>x.id===id);
function esc(value=''){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function displayName(item){return item.name || '未命名預留儲位 · '+item.id;}
function locationPath(id){
  if(id===null)return '未指定';
  const names=[],seen=new Set();let x=locById(id);
  while(x&&!seen.has(x.id)){names.unshift(displayName(x));seen.add(x.id);x=locById(x.parentId);}
  return names.join(' › ') || '找不到儲位';
}
function pathOf(item){
  if(item.type!=='item')return locationPath(item.id);
  const stocks=state.stocks.filter(x=>x.partId===item.id);
  return stocks.length?stocks.map(x=>locationPath(x.locationId)).join(' ／ '):'尚未設定存放位置';
}
function descendants(id){
  const found=[],seen=new Set([id]),queue=[id];
  while(queue.length){const parent=queue.shift();state.locations.filter(x=>x.parentId===parent).forEach(x=>{
    if(!seen.has(x.id)){seen.add(x.id);found.push(x);queue.push(x.id);}
  });}
  return found;
}
function quantityText(stock){return stock.quantityState==='UNKNOWN'?'數量未知':String(stock.quantity);}
function totalText(part){
  const sum=WarehouseCore.summary(state,part.id);
  if(!sum.locations)return '尚無庫存記錄';
  return (sum.unknown ? '已知合計 ' : '合計 ')+sum.known+' '+part.unit+(sum.unknown?'，另有 '+sum.unknown+' 處數量未知':'');
}
function normalizeName(value=''){return String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('zh-Hant');}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4500);}
function navHtml(){return nav.map(([id,icon,label])=>'<button class="nav-button '+(id==='add'?'add ':'')+(current===id?'active':'')+'" data-go="'+id+'"><span>'+icon+'</span><span>'+label+'</span></button>').join('');}
function bindNavigation(){
  $('#desktopNav').innerHTML=navHtml();$('#mobileNav').innerHTML=navHtml();
  $$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
}
function go(id){current=id;$$('.view').forEach(v=>v.classList.remove('active'));$('#'+id+'View').classList.add('active');render(id);bindNavigation();scrollTo({top:0,behavior:'smooth'});}
function row(item,subtitle){
  return '<div class="item-row"><span class="type-icon '+item.type+'">'+typeIcon[item.type]+'</span><div class="row-body"><div class="row-title">'+esc(displayName(item))+'</div><div class="path">'+esc(subtitle||pathOf(item))+'</div>'+(item.type==='item'?'<small>'+esc(totalText(item))+'</small>':'<small>'+esc(item.status==='RESERVED'?'預留':'啟用')+'</small>')+'</div><button class="chevron" data-detail="'+esc(item.id)+'" aria-label="查看'+esc(displayName(item))+'">›</button></div>';
}
function bindDetails(){$$('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail));}
function locationOptions(exclude=[],selected=''){
  return '<option value="">未指定</option>'+state.locations.filter(x=>x.status==='ACTIVE'&&!exclude.includes(x.id)).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(locationPath(x.id))+'</option>').join('');
}
function renderHome(){
  $('#homeView').innerHTML='<div class="section-head"><h2>快速操作</h2></div><div class="quick-grid"><button class="quick" id="homeScan"><span class="icon">▦</span><b>掃描查詢</b><small>零件與儲位標籤</small></button><button class="quick" data-go="add"><span class="icon">＋</span><b>建立物品</b><small>照片、規格與初始儲位</small></button><button class="quick" data-go="move"><span class="icon">↪</span><b>移動位置</b><small>搬動容器或轉移庫存</small></button><button class="quick" data-go="locations"><span class="icon">☷</span><b>瀏覽位置</b><small>查看各儲位內容</small></button></div>';
  bindNavigation();bindDetails();$('#homeScan').onclick=()=>openScanner(scanResult);
}
function scanResult(code){
  const query=code.toLowerCase(),matches=items.filter(x=>x.id.toLowerCase()===query||x.barcode?.toLowerCase()===query);
  if(matches.length===1)return showDetail(matches[0].id);
  go('search');$('#query').value=code;$('#query').dispatchEvent(new Event('input'));
  if(!matches.length)toast('找不到這個標籤');
}
function renderSearch(){
  $('#searchView').innerHTML='<p class="eyebrow">Find items</p><h1 class="page-title">查詢物品</h1><div class="toolbar"><label class="searchbox"><span>⌕</span><input id="query" placeholder="名稱、編號、MPN、規格或位置"></label><button class="scan-button" id="searchScan">▦ 掃描</button></div><div class="pills">'+[['all','全部'],['item','零件'],['room','房間'],['cabinet','櫃子'],['box','箱子'],['RESERVED','預留']].map(([id,name])=>'<button class="pill '+(id==='all'?'active':'')+'" data-filter="'+id+'">'+name+'</button>').join('')+'</div><div class="card" id="results"></div>';
  let filter='all';
  const refresh=()=>{
    const q=$('#query').value.trim().toLocaleLowerCase('zh-Hant');
    const list=items.filter(x=>(filter==='all'||x.type===filter||x.status===filter)&&(!q||[displayName(x),x.id,x.barcode,x.manufacturer,x.mpn,x.specification,x.unit,x.note,pathOf(x)].some(v=>String(v||'').toLocaleLowerCase('zh-Hant').includes(q))));
    $('#results').innerHTML=list.map(x=>row(x)).join('')||'<div class="empty">沒有符合項目</div>';bindDetails();
  };
  $('#query').oninput=refresh;$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));refresh();});
  $('#searchScan').onclick=()=>openScanner(scanResult);refresh();
}
function inputField(name,label,value='',type='text'){
  return '<label><span class="label">'+label+'</span><input class="field" name="'+name+'" type="'+type+'" value="'+esc(value)+'"></label>';
}
function partFields(item={}){
  return inputField('manufacturer','製造商',item.manufacturer)+inputField('mpn','製造商料號 MPN',item.mpn)+inputField('specification','規格',item.specification)+inputField('unit','單位',item.unit||'個')+inputField('barcode','商品／原廠條碼（選填）',item.barcode)+'<small class="hint">保存包裝上的原廠條碼，供查詢使用；不同於系統 QR 編號。可手動輸入，目前相機僅辨識 QR。</small>';
}
function confirmedQuantity(field){
  if(field.value.trim()==='')throw new Error('請填入已確認的數量');
  const value=Number(field.value);
  if(!Number.isFinite(value)||value<0||value>1e12)throw new Error('數量必須為有效的非負數');
  return value;
}
function readPart(form){
  return Object.fromEntries(['name','manufacturer','mpn','specification','unit','barcode','note'].map(k=>[k,form.elements[k].value]));
}
async function submitForm(form,operation){
  if(form.dataset.busy)return;
  form.dataset.busy='1';form.querySelectorAll('button').forEach(x=>x.disabled=true);
  try{await operation();}catch(error){toast(error.message);}
  finally{delete form.dataset.busy;form.querySelectorAll('button').forEach(x=>x.disabled=false);}
}
function renderAdd(){
  $('#addView').innerHTML='<p class="eyebrow">New record</p><h1 class="page-title">建立物品</h1><form class="card form-card" id="addForm"><div class="photo" id="photoBox"><span>尚未加入照片</span></div><div class="photo-actions"><button type="button" class="secondary" id="takePhoto">拍照</button><button type="button" class="secondary" id="choosePhoto">選擇照片</button></div><input id="photoCamera" type="file" accept="image/*" capture="environment" hidden><input id="photoLibrary" type="file" accept="image/*" hidden><div class="form-grid two top-sm">'+inputField('name','名稱')+'<label><span class="label">種類</span><select class="field" name="type"><option value="item">一般物品</option><option value="room">房間</option><option value="cabinet">櫃子</option><option value="box">箱子</option></select></label>'+'<label><span class="label">QR 編號（留空自動產生）</span><div class="field-pair"><input class="field" name="code" type="text"><button type="button" class="small-button" id="scanAddCode">掃描既有標籤</button></div><small class="hint">已有標籤可掃描或手動輸入編號；新標籤留空即可自動產生。</small></label>'+'<label><span class="label">上級／初始儲位</span><select class="field" name="locationId">'+locationOptions()+'</select></label><div class="part-fields">'+partFields()+'</div><div class="part-fields"><label><span class="label">初始數量</span><input class="field" name="quantity" type="number" min="0" max="1000000000000" step="0.000001" required></label><small class="hint">請填入已確認的數量；0 代表確認沒有庫存，不能留空。</small></div><label class="location-fields" hidden><span class="label">儲位狀態</span><select class="field" name="status"><option value="ACTIVE">啟用</option><option value="RESERVED">預留（可未命名）</option></select></label></div><label><span class="label">備註</span><textarea class="field" name="note" maxlength="5000"></textarea></label><button class="primary">建立</button></form>';
  const form=$('#addForm');let photo='',photoBusy=false;
  const update=()=>{
    const isPart=form.elements.type.value==='item';
    $$('.part-fields').forEach(x=>x.hidden=!isPart);$$('.location-fields').forEach(x=>x.hidden=isPart);
    form.elements.name.required=isPart||form.elements.status.value==='ACTIVE';
    form.elements.quantity.disabled=!isPart;
    form.elements.quantity.required=isPart;
  };
  form.elements.type.onchange=form.elements.status.onchange=update;update();
  $('#takePhoto').onclick=()=>$('#photoCamera').click();$('#choosePhoto').onclick=()=>$('#photoLibrary').click();
  $('#scanAddCode').onclick=()=>openScanner(code=>form.elements.code.value=code);
  attachLocationScanner(form.elements.locationId,'掃描儲位 QR');
  const handle=async event=>{
    const file=event.target.files[0];if(!file)return;photoBusy=true;photo='';
    form.querySelector('button.primary').disabled=true;
    try{photo=await prepareWarehousePhoto(file);$('#photoBox').innerHTML='<img alt="照片預覽"><span>照片已準備</span>';$('#photoBox img').src=photo;}
    catch(error){toast(error.message);$('#photoBox').innerHTML='<span>照片處理失敗，請重新選擇</span>';}
    finally{photoBusy=false;form.querySelector('button.primary').disabled=false;event.target.value='';}
  };
  $('#photoCamera').onchange=$('#photoLibrary').onchange=handle;
  form.onsubmit=event=>{event.preventDefault();submitForm(form,async()=>{
    if(photoBusy)throw new Error('請等候照片處理完成');
    const isPart=form.elements.type.value==='item',name=form.elements.name.value;
    const same=items.filter(x=>normalizeName(x.name)===normalizeName(name)&&name.trim());
    if(same.length&&!confirm('已有相同名稱的項目，仍要新增不同物品嗎？'))return;
    const command=isPart?{action:'createPart',input:readPart(form),initialStock:{locationId:form.elements.locationId.value||null,quantityState:'KNOWN',quantity:confirmedQuantity(form.elements.quantity)}}:{action:'createLocation',input:{name,type:form.elements.type.value,status:form.elements.status.value,parentId:form.elements.locationId.value||null,note:form.elements.note.value}};
    command.code=form.elements.code.value.trim();if(photo)command.photo=photo;
    const result=await warehouseCloud.mutate(command);toast('已建立 '+result.result.id);showDetail(result.result.id);
  });};
}
function renderLocations(){
  const visited=new Set();
  function tree(parent=null){
    return state.locations.filter(x=>x.parentId===parent).map(loc=>{
      if(visited.has(loc.id))return '';visited.add(loc.id);
      const content=state.stocks.filter(s=>s.locationId===loc.id).map(s=>{const p=byId(s.partId);return p?row(p,quantityText(s)+' '+p.unit):'';}).join('');
      return '<div><div class="tree-line"><span class="type-icon '+loc.type+'">'+typeIcon[loc.type]+'</span><button class="tree-name" data-detail="'+esc(loc.id)+'">'+esc(displayName(loc))+'</button><span>'+esc(loc.status==='RESERVED'?'預留':'')+'</span></div><div class="tree-children">'+content+tree(loc.id)+'</div></div>';
    }).join('');
  }
  const unspecified=state.stocks.filter(s=>s.locationId===null).map(s=>{const p=byId(s.partId);return p?row(p,'未指定 · '+quantityText(s)+' '+p.unit):'';}).join('');
  $('#locationsView').innerHTML='<p class="eyebrow">Location tree</p><h1 class="page-title">位置瀏覽</h1><div class="card tree-card">'+(tree()||'<div class="empty">尚無儲位</div>')+(unspecified?'<h3>未指定</h3>'+unspecified:'')+'</div>';
  bindDetails();
}
function renderMove(){
  $('#moveView').innerHTML='<p class="eyebrow">Relocate</p><h1 class="page-title">移動位置</h1><p class="page-sub">搬動容器不改數量；只搬一部分零件請用庫存轉移。</p><form class="card form-card" id="moveForm"><h2>搬動房間、櫃子或箱子</h2><label>要移動的容器<select class="field" name="id" required><option value="">請選擇</option>'+state.locations.map(x=>'<option value="'+esc(x.id)+'">'+esc(locationPath(x.id))+'</option>').join('')+'</select></label><label>新的上級位置<select class="field" name="parentId">'+locationOptions()+'</select></label><p id="movePreview"></p><button class="primary">確認移動容器</button></form><form class="card form-card top-sm" id="transferForm"><h2>轉移部分庫存</h2><p>選擇或掃描來源與目的儲位；目的庫存記錄會在轉移時一起建立。</p><label>來源<select class="field" name="from" required><option value="">請選擇</option>'+state.stocks.map(s=>'<option value="'+esc(s.id)+'">'+esc((partById(s.partId)?.name||s.partId)+' · '+locationPath(s.locationId)+' · '+quantityText(s))+'</option>').join('')+'</select></label><label>目的儲位<select class="field" name="to" required></select></label><label>數量<input class="field" name="amount" type="number" min="0.000001" max="1000000000000" step="0.000001" required></label>'+inputField('reason','原因')+'<button class="primary">確認轉移庫存</button></form>';
  const move=$('#moveForm');
  move.elements.id.onchange=()=>{
    const x=locById(move.elements.id.value);if(!x)return;
    move.elements.parentId.innerHTML=locationOptions([x.id,...descendants(x.id).map(d=>d.id)],x.parentId||'');
    $('#movePreview').textContent='目前：'+locationPath(x.id)+'；移動後內容物數量不變';
  };
  attachLocationScanner(move.elements.id,'掃描容器 QR',()=>state.locations);
  attachLocationScanner(move.elements.parentId,'掃描目的儲位 QR',()=>state.locations.filter(x=>x.status==='ACTIVE'));
  move.onsubmit=event=>{event.preventDefault();submitForm(move,async()=>{
    const x=locById(move.elements.id.value);if(!x)throw new Error('請先選擇容器');
    await warehouseCloud.mutate({action:'moveLocation',id:x.id,parentId:move.elements.parentId.value||null,expectedVersion:x.version});toast('容器已移動');
  });};
  const transfer=$('#transferForm');
  transfer.elements.from.onchange=()=>{
    const from=state.stocks.find(x=>x.id===transfer.elements.from.value);
    transfer.elements.to.innerHTML='<option value="">請選擇</option>'+state.locations.filter(x=>x.status==='ACTIVE'&&x.id!==from?.locationId).map(x=>'<option value="'+esc(x.id)+'">'+esc(locationPath(x.id))+'</option>').join('');
    if(from?.locationId!==null)transfer.elements.to.innerHTML+='<option value="__unassigned__">未指定</option>'; 
  };
  attachStockSourceScanner(transfer);
  attachLocationScanner(transfer.elements.to,'掃描目的儲位 QR');
  transfer.onsubmit=event=>{event.preventDefault();submitForm(transfer,async()=>{
    const from=state.stocks.find(x=>x.id===transfer.elements.from.value),target=transfer.elements.to.value;
    if(!from||!target)throw new Error('請選擇來源及目的儲位');
    const toLocationId=target==='__unassigned__'?null:target,to=state.stocks.find(x=>x.partId===from.partId&&x.locationId===toLocationId);
    await warehouseCloud.mutate({action:'transferStock',fromStockId:from.id,toLocationId,expectedFromVersion:from.version,expectedToVersion:to?to.version:null,amount:confirmedQuantity(transfer.elements.amount),reason:transfer.elements.reason.value});toast('兩端庫存已一起更新');
  });};
}

function attachLocationScanner(select,label,choices){
 const button=document.createElement('button');button.type='button';button.className='secondary top-sm';button.textContent=label;select.after(button);
 button.onclick=()=>openScanner(code=>{
  const loc=state.locations.find(x=>x.id.toLowerCase()===code.trim().toLowerCase());
  if(!loc)return toast('找不到這個儲位編號，請用選單或手動輸入');
  if(choices&&!choices().some(x=>x.id===loc.id))return toast('這個儲位目前不可選取');
  const option=Array.from(select.options).find(x=>x.value===loc.id&&!x.disabled);
  if(!option)return toast('這個儲位不可選取；請先選擇來源，且不可放入自己或下層');
  select.value=option.value;select.dispatchEvent(new Event('change'));toast('已選取 '+displayName(loc));
 });
}
function attachStockSourceScanner(form){
 const select=form.elements.from,scan=document.createElement('button'),all=document.createElement('button');
 scan.type=all.type='button';scan.className=all.className='secondary top-sm';scan.textContent='掃描來源零件／儲位 QR';all.textContent='顯示全部來源';select.after(scan,all);
 let partFilter=null,locationFilter;
 const render=()=>{
  const candidates=state.stocks.filter(s=>(!partFilter||s.partId===partFilter)&&(locationFilter===undefined||s.locationId===locationFilter));
  select.innerHTML='<option value="">請選擇</option>'+candidates.map(s=>'<option value="'+esc(s.id)+'">'+esc((partById(s.partId)?.name||s.partId)+' · '+locationPath(s.locationId)+' · '+quantityText(s))+'</option>').join('');
  select.value=candidates.length===1?candidates[0].id:'';select.dispatchEvent(new Event('change'));
  toast(candidates.length===1?'已選取來源':candidates.length?'有多筆來源，請用選單選擇或繼續掃描':'沒有符合來源，請顯示全部後重新選擇');
 };
 all.onclick=()=>{partFilter=null;locationFilter=undefined;render();};
 scan.onclick=()=>openScanner(code=>{
  const key=code.trim().toLowerCase(),parts=state.parts.filter(p=>p.id.toLowerCase()===key||p.barcode?.toLowerCase()===key),loc=state.locations.find(l=>l.id.toLowerCase()===key);
  if(parts.length===1)partFilter=parts[0].id;
  else if(loc)locationFilter=loc.id;
  else return toast(parts.length?'同條碼有多個零件，請從全部來源選擇':'找不到來源編號，請用選單或手動輸入');
  render();
 });
}

function showDetail(id){
  const item=byId(id);if(!item)return;
  const generation=++detailGeneration,d=$('#detailDialog'),isPart=item.type==='item';
  if(d.open)d.close();
  const stocks=state.stocks.filter(s=>isPart?s.partId===id:s.locationId===id);
  const stockHTML=isPart?'<h3>分儲位庫存</h3>'+stocks.map(s=>'<div class="item-row"><div class="row-body"><b>'+esc(locationPath(s.locationId))+'</b><p>'+esc(quantityText(s)+' '+item.unit)+'</p><small>版次 '+s.version+'</small></div><button class="small-button" data-adjust="'+esc(s.id)+'">調整／紀錄</button></div>').join('')+'<button class="secondary" id="addStock">新增存放位置</button>':'<h3>此儲位的零件</h3>'+stocks.map(s=>{const p=byId(s.partId);return p?row(p,quantityText(s)+' '+p.unit):'';}).join('')+'<h3>子儲位</h3>'+state.locations.filter(x=>x.parentId===id).map(x=>row(x)).join('');
  d.innerHTML='<div class="dialog-head"><h2>'+typeName[item.type]+'</h2><button class="close" data-close-detail>×</button></div><div class="dialog-body"><div class="detail-photo" id="detailPhoto"><span>'+typeIcon[item.type]+' 尚未加入照片</span></div><div class="crumbs">'+esc(pathOf(item))+'</div><h2>'+esc(displayName(item))+'</h2><span class="code">'+esc(item.id)+'</span><p>版次 '+item.version+' · '+esc(item.status==='RESERVED'?'預留':'啟用')+'</p>'+(isPart?'<p>'+esc(totalText(item))+'</p><dl>'+[['製造商',item.manufacturer],['MPN',item.mpn],['規格',item.specification],['單位',item.unit],['條碼',item.barcode]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v||'未填')+'</dd>').join('')+'</dl>':'')+'<p class="literal-text">'+esc(item.note)+'</p>'+stockHTML+'<div class="detail-actions"><button class="secondary" id="editItem">修改資料</button><button class="secondary" id="showHistory">操作紀錄</button><button class="primary" data-close-detail>關閉</button></div><div id="entityHistory"></div></div>';
  d.showModal();d.querySelectorAll('[data-close-detail]').forEach(b=>b.onclick=()=>d.close());
  d.querySelector('#editItem').onclick=()=>openEditDialog(item);
  d.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail));
  if(isPart){
    d.querySelector('#addStock').onclick=()=>openStockDialog(item);
    d.querySelectorAll('[data-adjust]').forEach(b=>b.onclick=()=>openQuantityDialog(item,state.stocks.find(s=>s.id===b.dataset.adjust)));
  }
  d.querySelector('#showHistory').onclick=async()=>{
    try{const result=await warehouseCloud.request({action:'history',id});if(generation!==detailGeneration||!d.open)return;d.querySelector('#entityHistory').innerHTML=historyHTML(result.records);}
    catch(error){toast(error.message);}
  };
  if(item.photoId)warehouseCloud.request({action:'photo',id}).then(result=>{
    if(generation!==detailGeneration||!d.open||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(result.photo))return;
    const image=document.createElement('img');image.src=result.photo;image.alt=displayName(item);d.querySelector('#detailPhoto').replaceChildren(image);
  }).catch(error=>toast(error.message));
}
const actionNames={createPart:'新增零件',createLocation:'新增儲位',updatePart:'修改零件',updateLocation:'修改儲位',moveLocation:'移動容器',createStock:'新增存放位置',adjustQuantity:'調整數量',transferStock:'轉移庫存'};
function historyHTML(records){
  return records.length?records.map(event=>'<div class="history-entry"><b>'+esc(actionNames[event.action]||event.action)+'</b><div>'+esc(event.reason||'未填原因')+'</div>'+event.changes.filter(c=>c.table==='stocks').map(c=>'<div>'+esc(c.before?quantityText(c.before):'未建立')+' → '+esc(quantityText(c.after))+'</div>').join('')+'<small>'+esc(new Date(event.time).toLocaleString('zh-TW'))+' · '+esc(event.actor||'共用金鑰')+'</small></div>').join(''):'<p>尚無操作紀錄</p>';
}
function openEditDialog(item){
  const d=$('#editDialog'),isPart=item.type==='item';
  d.innerHTML='<div class="dialog-head"><h2>修改資料</h2><button class="close" type="button">×</button></div><form class="dialog-body">'+inputField('name','名稱',item.name)+(isPart?partFields(item):'<label>種類<select class="field" name="type">'+['room','cabinet','box'].map(t=>'<option value="'+t+'" '+(item.type===t?'selected':'')+'>'+typeName[t]+'</option>').join('')+'</select></label><label>狀態<select class="field" name="status"><option value="ACTIVE" '+(item.status==='ACTIVE'?'selected':'')+'>啟用</option><option value="RESERVED" '+(item.status==='RESERVED'?'selected':'')+'>預留</option></select></label>')+'<label>備註<textarea class="field" name="note" maxlength="5000">'+esc(item.note)+'</textarea></label><p>編號固定：'+esc(item.id)+' · 讀取版次 '+item.version+'</p><button class="primary">儲存修改</button></form>';
  d.showModal();const form=d.querySelector('form');
  d.querySelector('.close').onclick=()=>{if(!form.dataset.busy)d.close();};d.oncancel=e=>{if(form.dataset.busy)e.preventDefault();};
  form.onsubmit=event=>{event.preventDefault();submitForm(form,async()=>{
    const input=isPart?readPart(form):{name:form.elements.name.value,type:form.elements.type.value,status:form.elements.status.value,note:form.elements.note.value};
    await warehouseCloud.mutate({action:isPart?'updatePart':'updateLocation',id:item.id,input,expectedVersion:item.version});
    d.close();showDetail(item.id);toast('資料已更新');
  });};
}
function openStockDialog(part){
  const d=$('#editDialog'),used=state.stocks.filter(x=>x.partId===part.id).map(x=>x.locationId);
  d.innerHTML='<div class="dialog-head"><h2>新增存放位置</h2><button class="close" type="button">×</button></div><form class="dialog-body"><label>儲位<select class="field" name="locationId">'+locationOptions(used.filter(x=>x!==null))+'</select></label><label>數量<input class="field" name="quantity" type="number" min="0" max="1000000000000" step="0.000001" required></label><small class="hint">請填入已確認的數量；0 代表確認沒有庫存，不能留空。</small><button class="primary">建立庫存記錄</button></form>';
  const form=d.querySelector('form');if(used.includes(null))form.elements.locationId.querySelector('option[value=""]').disabled=true;
  attachLocationScanner(form.elements.locationId,'掃描儲位 QR');
  d.showModal();d.querySelector('.close').onclick=()=>{if(!form.dataset.busy)d.close();};d.oncancel=e=>{if(form.dataset.busy)e.preventDefault();};
  form.onsubmit=event=>{event.preventDefault();submitForm(form,async()=>{
    if(used.includes(form.elements.locationId.value||null))throw new Error('該位置已有庫存記錄');
    await warehouseCloud.mutate({action:'createStock',partId:part.id,locationId:form.elements.locationId.value||null,quantityState:'KNOWN',quantity:confirmedQuantity(form.elements.quantity)});
    d.close();showDetail(part.id);toast('已新增存放位置');
  });};
}
function render(id){({home:renderHome,search:renderSearch,add:renderAdd,move:renderMove,locations:renderLocations}[id]||renderHome)();}
function openScanner(callback){scanCallback=callback;$('#scannerDialog').showModal();$('#scanMessage').textContent='可啟動後鏡頭，或手動輸入編號'}async function stopCamera(){detecting=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('#scannerVideo').srcObject=null}async function finishScan(code){const callback=scanCallback;await stopCamera();$('#scannerDialog').close();navigator.vibrate?.(80);toast('已讀取標籤');callback?.(code)}
$('#scannerDialog [data-close]').onclick=()=>{stopCamera();$('#scannerDialog').close()};$('#cameraButton').onclick=async()=>{try{await stopCamera();if(!navigator.mediaDevices?.getUserMedia)throw Error('此瀏覽器不支援相機');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});if(!$('#scannerDialog').open){await stopCamera();return;}$('#scannerVideo').srcObject=stream;await $('#scannerVideo').play();$('#scanMessage').textContent='請將QR Code對準框內';if('BarcodeDetector'in window&&(await BarcodeDetector.getSupportedFormats()).includes('qr_code')){detector=new BarcodeDetector({formats:['qr_code']});detecting=true;detectLoop()}else $('#scanMessage').textContent='相機已開啟；此瀏覽器請使用手動輸入備援'}catch(e){$('#scanMessage').textContent=e.message||'無法啟動相機';toast('請檢查相機權限')}};async function detectLoop(){if(!detecting)return;try{const codes=await detector.detect($('#scannerVideo'));if(codes[0]?.rawValue)return finishScan(codes[0].rawValue)}catch(e){}requestAnimationFrame(detectLoop)}

$('#scannerDialog').addEventListener('cancel',()=>stopCamera());
$('#scannerDialog').addEventListener('close',()=>stopCamera());
$('#demoScanButton').onclick=()=>{const item=items[0];item?finishScan(item.id):toast('請先載入資料');};
$('#manualScanButton').onclick=()=>{const code=prompt('請輸入 QR 編號或條碼');if(code)finishScan(code.trim());};
warehouseCloud.onState=next=>{
  state=next;items=state.locations.map(x=>({...x})).concat(state.parts.map(x=>({...x,type:'item'})));
  detailGeneration++;['detailDialog','editDialog','quantityDialog'].forEach(id=>{const d=$('#'+id);if(d.open)d.close();});
  render(current);bindNavigation();
};
window.WarehouseUI={locationPath,pathOf,totalText,quantityText,descendants,scanResult};
bindNavigation();renderHome();
