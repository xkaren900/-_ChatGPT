/* GitHub UI, backed by separate parts / locations / stock collections. */
const typeName={room:'房間',cabinet:'櫃子',box:'箱子',item:'一般物品'};
const typeIcon={room:'⌂',cabinet:'▥',box:'▣',item:'◆'};
const nav=[['home','⌂','首頁'],['search','⌕','查詢'],['add','＋','新增'],['move','↪','移動'],['locations','☷','位置']];
let addMode=null,addDrafts={},archivedStocks=[],state=WarehouseCore.empty(),items=[],current='home',scanCallback=null,stream=null,detector=null,detecting=false,detailGeneration=0;
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
function go(id){if(id==='add'){addMode=null;renderAdd();openCreationDialog();return;}const label=nav.find(x=>x[0]===id)?.[2]||'頁面';toast('正在開啟'+label+'…');const activity=$('#pageActivity');if(activity)activity.textContent=label+'頁面已就緒';current=id;$$('.view').forEach(v=>v.classList.remove('active'));$('#'+id+'View').classList.add('active');render(id);bindNavigation();scrollTo({top:0,behavior:'smooth'});}
function row(item,subtitle){
  return '<div class="item-row"><span class="type-icon '+item.type+'">'+typeIcon[item.type]+'</span><div class="row-body"><div class="row-title">'+esc(displayName(item))+'</div><div class="path">'+esc(subtitle||pathOf(item))+'</div>'+(item.type==='item'?'<small>'+esc(totalText(item))+'</small>':'<small>'+esc(item.status==='RESERVED'?'預留':'啟用')+'</small>')+'</div><button class="chevron" data-detail="'+esc(item.id)+'" aria-label="查看'+esc(displayName(item))+'">›</button></div>';
}
function bindDetails(){$$('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail));}
function locationOptions(exclude=[],selected=''){
  return '<option value="">未指定</option>'+state.locations.filter(x=>x.status==='ACTIVE'&&!exclude.includes(x.id)).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(locationPath(x.id)+' · '+x.id)+'</option>').join('');
}
function renderHome(){
  $('#homeView').innerHTML='<div class="section-head"><h2>快速操作</h2></div><div class="quick-grid"><button class="quick" id="homeScan"><span class="icon">▦</span><b>掃描查詢</b><small>零件與儲位標籤</small></button><button class="quick" data-go="add"><span class="icon">＋</span><b>建立物品</b><small>照片、規格與初始儲位</small></button><button class="quick" data-go="move"><span class="icon">↪</span><b>移動位置</b><small>搬動容器或轉移庫存</small></button><button class="quick" data-go="locations"><span class="icon">☷</span><b>瀏覽位置</b><small>查看各儲位內容</small></button></div>';
  bindNavigation();bindDetails();$('#homeScan').onclick=()=>{go('search');openScanner(scanResult);};
}
function scanResult(code){
  const query=code.toLowerCase(),matches=items.filter(x=>x.id.toLowerCase()===query||x.barcode?.toLowerCase()===query);
  if(matches.length===1)return showDetail(matches[0].id);
  go('search');$('#query').value=code;$('#query').dispatchEvent(new Event('input'));
  if(!matches.length)toast('找不到這個標籤');
}
function renderSearch(){
  $('#searchView').innerHTML='<p class="eyebrow">Find items</p><h1 class="page-title">查詢物品</h1><div class="toolbar"><label class="searchbox"><span>⌕</span><input id="query" placeholder="名稱、編號、MPN、規格或位置"></label><button class="scan-button" id="searchScan">▦ 掃描</button></div><div class="pills">'+[['all','全部'],['item','零件'],['room','房間'],['cabinet','櫃子'],['box','箱子'],['RESERVED','預留']].map(([id,name])=>'<button class="pill '+(id==='all'?'active':'')+'" data-filter="'+id+'">'+name+'</button>').join('')+'</div><p id="queryStatus" role="status">請輸入查詢條件</p><div class="card" id="results"></div>';
  let filter='all';
  const refresh=()=>{
    const q=$('#query').value.trim().toLocaleLowerCase('zh-Hant');
    const list=items.filter(x=>(filter==='all'||x.type===filter||x.status===filter)&&(!q||[displayName(x),x.id,x.barcode,x.manufacturer,x.mpn,x.specification,x.unit,x.note,pathOf(x)].some(v=>String(v||'').toLocaleLowerCase('zh-Hant').includes(q))));
    $('#queryStatus').textContent='查詢完成，共 '+list.length+' 筆';
    $('#results').innerHTML=list.map(x=>row(x)).join('')||'<div class="empty">沒有符合項目</div>';bindDetails();
  };
  $('#query').oninput=()=>{ $('#queryStatus').textContent='查詢中…';refresh();};$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));refresh();});
  const searchButton=document.createElement('button');searchButton.type='button';searchButton.className='scan-button';searchButton.textContent='查詢';searchButton.id='searchSubmit';$('#searchScan').before(searchButton);
  searchButton.onclick=refresh;$('#query').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();refresh();}};
  $('#searchScan').onclick=()=>openScanner(scanResult);
  $('#queryStatus').textContent='請輸入條件查詢；留空按「查詢」可列出全部';
  $('#results').innerHTML='<div class="empty">尚未查詢</div>';
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
  const submit=form.querySelector('button[type="submit"]')||form.querySelector('button.primary'),oldText=submit?.textContent;
  form.dataset.busy='1';form.setAttribute('aria-busy','true');form.querySelectorAll('button').forEach(x=>x.disabled=true);
  const message=oldText?.includes('建立')?'新增中…':oldText?.includes('查詢')?'查詢中…':'儲存中…';
  if(submit)submit.textContent=message;
  let progress=form.querySelector('.operation-status');if(!progress){progress=document.createElement('p');progress.className='operation-status';progress.setAttribute('role','status');form.append(progress);}progress.textContent=message+' 請稍候，勿重複操作';
  try{await operation();}catch(error){toast(error.message);}
  finally{delete form.dataset.busy;form.removeAttribute('aria-busy');if(submit)submit.textContent=oldText;progress.textContent='';form.querySelectorAll('button').forEach(x=>x.disabled=false);}
}

function confirmDuplicateName(matches){
 const d=$('#duplicateDialog');
 d.innerHTML='<div class="dialog-head"><h2>已有同名項目</h2></div><div class="dialog-body"><p>名稱可以重複，每一個盒子或物品以獨立 QR 編號區分。請確認這是另一個盒子或物品。</p><div class="duplicate-list">'+matches.map(x=>'<div class="duplicate-item"><div><b>'+esc(displayName(x))+'</b><span>'+esc(pathOf(x))+'</span><code>'+esc(x.id)+'</code></div></div>').join('')+'</div><div class="detail-actions"><button type="button" class="secondary" data-duplicate-cancel>返回檢查</button><button type="button" class="primary" data-duplicate-continue>仍要新增另一個</button></div></div>';
 return new Promise(resolve=>{let done=false;const finish=answer=>{if(done)return;done=true;d.close();resolve(answer);};d.querySelector('[data-duplicate-cancel]').onclick=()=>finish(false);d.querySelector('[data-duplicate-continue]').onclick=()=>finish(true);d.oncancel=e=>{e.preventDefault();finish(false);};d.onclose=()=>finish(false);d.showModal();});
}

function buildAddCommand(mode,values,photo=''){
  const name=String(values.name||''),code=String(values.code||'').trim();
  if(code&&!/^[\w-]{1,100}$/.test(code))throw Error('QR 編號只接受英文、數字、底線及連字號，最多100字');
  let command;
  if(mode==='item'){
    if(!name.trim())throw Error('請輸入物品名稱');
    const input={name,unit:values.unit||'個'};
    for(const key of ['manufacturer','mpn','specification','barcode','note'])input[key]=values[key]||'';
    command={action:'createPart',input};
    if(String(values.quantity??'').trim()!=='')command.initialStock={locationId:values.locationId||null,quantityState:'KNOWN',quantity:WarehouseCore.amount(Number(values.quantity))};
  }else{
    const status=values.status||'ACTIVE',type=values.type||'box';
    if(!['ACTIVE','RESERVED'].includes(status)||!['room','cabinet','box'].includes(type))throw Error('請選擇有效的儲位種類與狀態');
    if(status==='ACTIVE'&&!name.trim())throw Error('請輸入儲位名稱，或選擇預留');
    command={action:'createLocation',input:{name,type,status,parentId:values.locationId||null,note:values.note||''}};
  }
  command.code=code;if(photo)command.photo=photo;return command;
}
function openCreationDialog(){
  const dialog=$('#creationDialog');
  dialog.oncancel=event=>{if(Object.values(addDrafts).some(d=>d.submitting))event.preventDefault();};
  dialog.onclose=()=>document.body.classList.remove('creation-open');
  $('#closeCreationDialog').onclick=closeCreationDialog;
  document.body.classList.add('creation-open');if(!dialog.open)dialog.showModal();
}
function closeCreationDialog(){
  if(Object.values(addDrafts).some(d=>d.submitting))return;
  $('#creationDialog').close();document.body.classList.remove('creation-open');
}
function renderAdd(){
  $('#creationDialogTitle').textContent='新增';$('#closeCreationDialog').disabled=false;
  if(addMode){renderAddWizard(addMode);return;}
  $('#addView').innerHTML='<p class="eyebrow">New record</p><h1 class="page-title">新增</h1><p class="page-sub">要建立什麼？選擇後依步驟填寫，最後確認才會儲存。草稿只保留在目前頁面，重新整理或關閉後會清除。</p><div class="creation-choices"><button class="quick" data-create-mode="item"><span class="icon">◆</span><b>物品</b><small>零件、耗材與其他物品</small>'+(addDrafts.item?'<span class="hint">繼續未完成的草稿</span>':'')+'</button><button class="quick" data-create-mode="location"><span class="icon">▣</span><b>儲位</b><small>房間、櫃子或零件盒</small>'+(addDrafts.location?'<span class="hint">繼續未完成的草稿</span>':'')+'</button></div>';
  $$('[data-create-mode]').forEach(button=>button.onclick=()=>{addMode=button.dataset.createMode;renderAddWizard(addMode);});
}
function renderAddWizard(mode){
  $('#creationDialogTitle').textContent=mode==='item'?'新增物品':'新增儲位';
  const isPart=mode==='item',draft=addDrafts[mode]||(addDrafts[mode]={values:{name:'',code:'',quantity:'',unit:'個',manufacturer:'',mpn:'',specification:'',barcode:'',note:'',locationId:'',type:'box',status:'ACTIVE'},step:0,photo:'',photoBusy:false,photoError:''});
  const titles=isPart?['拍照','掃描 QR','物品名稱','數量與單位','其他資訊','存放儲位','確認完成']:['拍照','掃描 QR','名稱與種類','上級儲位','備註','確認完成'];
  const photoHTML='<div class="photo" id="photoBox">'+(draft.photo?'<img alt="照片預覽">':'<span>'+esc(draft.photoBusy?'正在處理照片…':draft.photoError||'尚未加入照片')+'</span>')+'</div><div class="photo-actions"><button type="button" class="secondary" id="takePhoto">拍照</button><button type="button" class="secondary" id="choosePhoto">選擇照片</button><button type="button" class="secondary" id="removeDraftPhoto">移除照片</button></div><input id="photoCamera" type="file" accept="image/*" capture="environment" hidden><input id="photoLibrary" type="file" accept="image/*" hidden><p class="hint">選填。沒有照片可直接下一步，之後也可返回補上。</p>';
  const qrHTML=inputField('code',(isPart?'物品':'儲位')+' QR 編號（可略過）')+'<button type="button" class="secondary top-sm" id="scanAddCode">掃描既有 QR 標籤</button><p class="hint">未貼標籤可留空，完成時自動產生唯一編號；也可手動輸入。'+(isPart?'這不是存放儲位的 QR。':'這是新儲位本身的 QR；上級儲位會在後面選擇。')+'</p>';
  const nameHTML=inputField('name',isPart?'物品名稱（必填）':'儲位名稱')+(isPart?'':'<label>儲位種類<select class="field" name="type"><option value="room">房間</option><option value="cabinet">櫃子</option><option value="box">箱子／零件盒</option></select></label><label>儲位狀態<select class="field" name="status"><option value="ACTIVE">啟用</option><option value="RESERVED">預留（可稍後命名）</option></select></label>')+'<p class="hint">名稱可以重複，系統以 QR 編號區分每一個'+(isPart?'物品':'儲位')+'。</p>';
  const quantityHTML='<label>數量（可留空）<input class="field" name="quantity" type="number" min="0" max="1000000000000" step="0.000001"></label>'+inputField('unit','單位','個')+'<p class="hint">單位預設「個」。數量留空只建立物品，之後再建立儲位與庫存；填0代表已確認沒有庫存。</p>';
  const noteHTML='<label>備註（選填）<textarea class="field" name="note" maxlength="5000"></textarea></label>';
  const otherHTML=inputField('manufacturer','製造商（選填）')+inputField('mpn','製造商料號 MPN（選填）')+inputField('specification','規格（選填）')+inputField('barcode','商品／原廠條碼（選填）')+noteHTML;
  const locationHTML='<label>'+(isPart?'存放儲位':'上級儲位')+'（可略過）<select class="field" name="locationId">'+locationOptions()+'</select></label><p id="wizardLocationHint" class="hint"></p>'+(isPart?'<button type="button" class="secondary" id="backToQuantity">返回填寫數量</button>':'');
  const panels=isPart?[photoHTML,qrHTML,nameHTML,quantityHTML,otherHTML,locationHTML,'<div id="wizardSummary"></div>']:[photoHTML,qrHTML,nameHTML,locationHTML,noteHTML,'<div id="wizardSummary"></div>'];
  $('#addView').innerHTML='<p class="eyebrow">New '+(isPart?'item':'location')+'</p><h1 class="page-title">新增'+(isPart?'物品':'儲位')+'</h1><button type="button" class="link-button" id="changeCreateMode">返回物品／儲位選擇（保留草稿）</button><form class="card form-card creation-wizard" id="addForm" novalidate><p id="wizardProgress" role="status"></p><progress id="wizardProgressBar" max="'+titles.length+'" value="1"></progress><h2 id="wizardTitle" tabindex="-1"></h2>'+panels.map((html,i)=>'<section class="creation-step stack" data-step="'+i+'" hidden>'+html+'</section>').join('')+'<p id="wizardError" role="alert"></p><div class="wizard-actions"><button type="button" class="secondary" id="wizardPrevious">上一步</button><button type="button" class="secondary" id="wizardNext">下一步</button><button type="submit" class="primary" id="wizardFinish" hidden>完成建立</button></div></form>';
  const form=$('#addForm'),steps=Array.from(form.querySelectorAll('[data-step]')),last=titles.length-1,locationStep=isPart?5:3;
  for(const [key,value] of Object.entries(draft.values)){const field=form.elements.namedItem(key);if(field)field.value=value;}
  if(draft.photo)$('#photoBox img').src=draft.photo;
  const save=()=>{for(const field of form.elements)if(field.name&&field.type!=='file')draft.values[field.name]=field.value;};
  const error=message=>{$('#wizardError').textContent=message;};
  function validate(index){
    save();const values=draft.values;
    if(draft.photoBusy){error('照片仍在處理中，請稍候');return false;}
    if(index===1&&values.code.trim()){
      const code=values.code.trim();
      if(!/^[\w-]{1,100}$/.test(code)){error('QR 編號只接受英文、數字、底線及連字號，最多100字');return false;}
      if(items.some(item=>item.id.toLowerCase()===code.toLowerCase())){error('這個 QR 編號已使用。請改用另一張標籤，或留空自動產生');return false;}
    }
    if(index===2&&(isPart||values.status==='ACTIVE')&&!values.name.trim()){error('請輸入'+(isPart?'物品':'儲位')+'名稱');form.elements.name.focus();return false;}
    if(index===2&&values.name.length>200){error('名稱不得超過200字');return false;}
    if(isPart&&index===3){
      if(form.elements.quantity.validity.badInput){error('請輸入有效數量，或清空欄位略過');return false;}
      if(values.quantity.trim())try{WarehouseCore.amount(Number(values.quantity));}catch(e){error(e.message);return false;}
      if(!values.unit.trim()){values.unit='個';form.elements.unit.value='個';}
      if(values.unit.length>30){error('單位不得超過30字');return false;}
    }
    const limits={manufacturer:200,mpn:200,specification:1000,barcode:200,note:5000};
    if((isPart&&index===4)||(!isPart&&index===4))for(const [key,limit] of Object.entries(limits))if(String(values[key]||'').length>limit){error('資訊長度超過限制，請縮短內容');return false;}
    if(index===locationStep&&(!isPart||values.quantity.trim())&&values.locationId&&!state.locations.some(x=>x.id===values.locationId&&x.status==='ACTIVE')){error('這個儲位目前不可使用，請重新選擇');return false;}
    error('');return true;
  }
  function summary(){
    save();const values=draft.values,hasQuantity=isPart&&values.quantity.trim()!=='';
    const details=[['QR 編號',values.code.trim()||'完成時自動產生'],['名稱',values.name||'未命名預留儲位']];
    if(isPart)details.push(['數量',hasQuantity?values.quantity+' '+(values.unit||'個'):'未填；本次只建立物品'],['存放儲位',hasQuantity?locationPath(values.locationId||null):'稍後設定']);
    else details.push(['種類',typeName[values.type]],['狀態',values.status==='RESERVED'?'預留':'啟用'],['上級儲位',locationPath(values.locationId||null)]);
    for(const [key,label] of Object.entries({manufacturer:'製造商',mpn:'MPN',specification:'規格',barcode:'原廠條碼',note:'備註'}))if((isPart||key==='note')&&values[key])details.push([label,values[key]]);
    $('#wizardSummary').innerHTML='<p>請確認以下內容；按「完成建立」後才會儲存。</p><dl class="creation-summary">'+details.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl><p>照片：'+(draft.photo?'已加入':'未加入')+'</p>';
  }
  function paint(focus=false){
    const index=draft.step=Math.min(Math.max(draft.step,0),last),noStock=isPart&&!form.elements.quantity.value.trim();
    steps.forEach((panel,i)=>{panel.hidden=i!==index;});
    $('#wizardProgress').textContent='步驟 '+(index+1)+'／'+titles.length;$('#wizardProgressBar').value=index+1;$('#wizardTitle').textContent=titles[index];
    const locked=draft.photoBusy||draft.submitting||draft.uncertain;
    $('#closeCreationDialog').disabled=!!draft.submitting;
    $('#wizardPrevious').hidden=index===0;$('#wizardNext').hidden=index===last;$('#wizardFinish').hidden=index!==last;$('#wizardFinish').disabled=index!==last||locked;
    $('#wizardPrevious').disabled=$('#wizardNext').disabled=$('#changeCreateMode').disabled=locked;
    for(const id of ['takePhoto','choosePhoto','removeDraftPhoto','scanAddCode'])$('#'+id).disabled=locked;
    form.elements.locationId.disabled=noStock||locked;
    const scan=steps[locationStep].querySelector('button[data-location-scan]');if(scan)scan.disabled=noStock||locked;
    if(draft.uncertain)error('上次建立結果尚未確認，請先按上方「確認上次操作」，不要重新建立。');
    $('#wizardLocationHint').textContent=noStock?'數量留空，本次不建立庫存或存放位置。可直接下一步，或返回填數量（可填0）。':isPart?'掃描儲位 QR、從選單選擇，或略過並暫存於「未指定」。':'掃描或選擇上級儲位；留空代表最上層儲位。';
    if(isPart)$('#backToQuantity').hidden=!noStock;
    if(index===last)summary();
    if(focus){$('#wizardTitle').focus({preventScroll:true});$('#wizardTitle').scrollIntoView({block:'start',behavior:'smooth'});}
  }
  form.oninput=()=>{save();error('');};form.onchange=()=>{save();paint();};
  form.elements.locationId.addEventListener('change',save);
  attachLocationScanner(form.elements.locationId,isPart?'掃描存放儲位 QR':'掃描上級儲位 QR');
  const locationButton=steps[locationStep].querySelector('select').nextElementSibling;locationButton.dataset.locationScan='1';
  $('#changeCreateMode').onclick=()=>{save();addMode=null;renderAdd();};
  const next=()=>{if(validate(draft.step)){draft.step++;paint(true);}};
  $('#wizardNext').onclick=next;$('#wizardPrevious').onclick=()=>{save();error('');draft.step--;paint(true);};
  if(isPart)$('#backToQuantity').onclick=()=>{save();draft.step=3;paint(true);};
  $('#scanAddCode').onclick=()=>openScanner(code=>{form.elements.code.value=code.trim();save();validate(1);});
  $('#takePhoto').onclick=()=>$('#photoCamera').click();$('#choosePhoto').onclick=()=>$('#photoLibrary').click();
  $('#removeDraftPhoto').onclick=()=>{draft.photo='';draft.photoError='';renderAddWizard(mode);};
  async function photoChanged(event){
    const file=event.target.files[0];if(!file)return;save();draft.photoBusy=true;draft.photo='';draft.photoError='';paint();$('#photoBox').innerHTML='<span>正在處理照片…</span>';
    try{draft.photo=await prepareWarehousePhoto(file);}catch(e){draft.photoError='照片處理失敗，可重新選擇或略過';toast(e.message);}
    finally{draft.photoBusy=false;if($('#creationDialog').open&&addMode===mode)renderAddWizard(mode);}
  }
  $('#photoCamera').onchange=$('#photoLibrary').onchange=photoChanged;
  form.onkeydown=event=>{if(event.key==='Enter'&&event.target.tagName!=='TEXTAREA'&&event.target.tagName!=='BUTTON'){event.preventDefault();if(draft.step<last)next();else $('#wizardFinish').click();}};
  form.onsubmit=async event=>{
    event.preventDefault();if(draft.step<last){next();return;}
    if(draft.submitting||draft.uncertain)return;
    for(let i=0;i<last;i++)if(!validate(i)){draft.step=i;paint(true);return;}
    const modeButton=$('#changeCreateMode');draft.submitting=true;modeButton.disabled=true;$('#closeCreationDialog').disabled=true;
    await submitForm(form,async()=>{
      save();const same=items.filter(x=>normalizeName(x.name)===normalizeName(draft.values.name)&&draft.values.name.trim());
      if(same.length&&!await confirmDuplicateName(same))return;
      const command=buildAddCommand(mode,draft.values,draft.photo);draft.submittedCommand=JSON.stringify(command);
      let result;try{result=await warehouseCloud.mutate(command);}catch(e){if(e.uncertain)draft.uncertain=true;throw e;}
      delete addDrafts[mode];addMode=null;renderAdd();closeCreationDialog();toast('已建立 '+result.result.id);showDetail(result.result.id);
    });
    draft.submitting=false;if(form.isConnected){modeButton.disabled=!!draft.uncertain;paint();}
  };
  paint();
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
  $('#moveView').innerHTML='<p class="eyebrow">Relocate</p><h1 class="page-title">移動位置</h1><p class="page-sub">搬動容器不改數量；只搬一部分零件請用庫存轉移。</p><form class="card form-card" id="moveForm"><h2>搬動房間、櫃子或箱子</h2><label>要移動的容器<select class="field" name="id" required><option value="">請選擇</option>'+state.locations.map(x=>'<option value="'+esc(x.id)+'">'+esc(locationPath(x.id)+' · '+x.id)+'</option>').join('')+'</select></label><label>新的上級位置<select class="field" name="parentId">'+locationOptions()+'</select></label><p id="movePreview"></p><button class="primary">確認移動容器</button></form><form class="card form-card top-sm" id="transferForm"><h2>搬移部分數量</h2><p>選擇或掃描來源與目的儲位；目的庫存記錄會在轉移時一起建立。</p><label>從哪裡搬<select class="field" name="from" required><option value="">請選擇</option>'+state.stocks.map(s=>'<option value="'+esc(s.id)+'">'+esc((partById(s.partId)?.name||s.partId)+' · '+locationPath(s.locationId)+' ['+(s.locationId||'未指定')+'] · '+quantityText(s))+'</option>').join('')+'</select></label><label>搬到哪裡<select class="field" name="to" required></select></label><label>搬多少<input class="field" name="amount" type="number" min="0.000001" max="1000000000000" step="0.000001" required></label>'+inputField('reason','原因')+'<button class="primary">確認搬移數量</button></form>';
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
    transfer.elements.to.innerHTML='<option value="">請選擇</option>'+state.locations.filter(x=>x.status==='ACTIVE'&&x.id!==from?.locationId).map(x=>'<option value="'+esc(x.id)+'">'+esc(locationPath(x.id)+' · '+x.id)+'</option>').join('');
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
 scan.type=all.type='button';scan.className=all.className='secondary top-sm';scan.textContent='掃描來源零件／儲位 QR';all.textContent='清除篩選，重新選擇';select.after(scan,all);
 let partFilter=null,locationFilter;
 const render=()=>{
  const candidates=state.stocks.filter(s=>(!partFilter||s.partId===partFilter)&&(locationFilter===undefined||s.locationId===locationFilter));
  select.innerHTML='<option value="">請選擇</option>'+candidates.map(s=>'<option value="'+esc(s.id)+'">'+esc((partById(s.partId)?.name||s.partId)+' · '+locationPath(s.locationId)+' ['+(s.locationId||'未指定')+'] · '+quantityText(s))+'</option>').join('');
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
  const stockHTML=isPart?'<h3>分儲位庫存</h3>'+stocks.map(s=>'<div class="item-row"><div class="row-body"><b>'+esc(locationPath(s.locationId))+'</b><p>'+esc(quantityText(s)+' '+item.unit)+'</p><small>版次 '+s.version+'</small></div><button class="small-button" data-adjust="'+esc(s.id)+'">調整／紀錄</button><button class="small-button" data-stock-manage="'+esc(s.id)+'">更改／移除儲位</button></div>').join('')+'<button class="secondary" id="addStock">新增存放位置</button>'+archivedStocks.filter(s=>s.partId===id).map(s=>'<div class="item-row"><span>已移除：'+esc(locationPath(s.locationId))+'</span><button class="small-button" data-stock-restore="'+esc(s.id)+'">還原</button></div>').join(''):'<h3>此儲位的零件</h3>'+stocks.map(s=>{const p=byId(s.partId);return p?row(p,quantityText(s)+' '+p.unit):'';}).join('')+'<h3>子儲位</h3>'+state.locations.filter(x=>x.parentId===id).map(x=>row(x)).join('');
  d.innerHTML='<div class="dialog-head"><h2>'+typeName[item.type]+'</h2><button class="close" data-close-detail>×</button></div><div class="dialog-body"><div class="detail-photo" id="detailPhoto"><span>'+typeIcon[item.type]+' 尚未加入照片</span></div><div class="crumbs">'+esc(pathOf(item))+'</div><h2>'+esc(displayName(item))+'</h2><span class="code">'+esc(item.id)+'</span><p>版次 '+item.version+' · '+esc(item.status==='RESERVED'?'預留':'啟用')+'</p>'+(isPart?'<p>'+esc(totalText(item))+'</p><dl>'+[['製造商',item.manufacturer],['MPN',item.mpn],['規格',item.specification],['單位',item.unit],['條碼',item.barcode]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v||'未填')+'</dd>').join('')+'</dl>':'')+'<p class="literal-text">'+esc(item.note)+'</p>'+stockHTML+'<div class="detail-actions"><button class="secondary" id="editItem">修改資料</button><button class="secondary" id="showHistory">操作紀錄</button><button class="primary" data-close-detail>關閉</button></div><div id="entityHistory"></div></div>';
  d.showModal();d.querySelectorAll('[data-close-detail]').forEach(b=>b.onclick=()=>d.close());
  d.querySelector('#editItem').onclick=()=>openEditDialog(item);
  d.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail));
  if(isPart){
    d.querySelector('#addStock').onclick=()=>openStockDialog(item);
    d.querySelectorAll('[data-stock-manage]').forEach(b=>b.onclick=()=>openStockManagement(item,state.stocks.find(s=>s.id===b.dataset.stockManage)));
    d.querySelectorAll('[data-stock-restore]').forEach(b=>b.onclick=()=>openStockRestore(item,archivedStocks.find(s=>s.id===b.dataset.stockRestore)));
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
const actionNames={archiveStock:'移除存放位置',restoreStock:'還原存放位置',relocateStock:'更改存放位置',createPart:'新增零件',createLocation:'新增儲位',updatePart:'修改零件',updateLocation:'修改儲位',moveLocation:'移動容器',createStock:'新增存放位置',adjustQuantity:'調整數量',transferStock:'轉移庫存'};
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

function openStockManagement(part,stock){
 const d=$('#editDialog');d.innerHTML='<div class="dialog-head"><h2>更改／移除儲位</h2><button type="button" class="close">×</button></div><form class="dialog-body"><p>目前：'+esc(locationPath(stock.locationId))+' · '+esc(quantityText(stock))+' '+esc(part.unit)+'</p><label>新的儲位<select class="field" name="locationId">'+locationOptions(stock.locationId===null?[]:[stock.locationId])+'</select></label><p>更改會搬移此位置的全部數量；目的已有庫存時合併，總數不變。</p><button class="primary" name="relocate">確認更改儲位</button><p>移除只適用於數量0或尚未盤點的記錄，歷史會保留並可還原。</p><label><input type="checkbox" name="confirmArchive"> 我確認要移除此存放記錄</label><button type="button" class="secondary" name="archive">移除此存放記錄</button></form>';
 const form=d.querySelector('form');if(stock.locationId===null)form.elements.locationId.querySelector('option[value=""]').disabled=true;
 attachLocationScanner(form.elements.locationId,'掃描目的儲位 QR');d.querySelector('.close').onclick=()=>{if(!form.dataset.busy)d.close();};d.oncancel=e=>{if(form.dataset.busy)e.preventDefault();};
 form.onsubmit=e=>{e.preventDefault();submitForm(form,async()=>{const target=form.elements.locationId.value||null;if(target===stock.locationId)throw Error('請選擇新的儲位');const to=state.stocks.find(s=>s.partId===part.id&&s.locationId===target);await warehouseCloud.mutate({action:'relocateStock',stockId:stock.id,expectedVersion:stock.version,toLocationId:target,expectedToVersion:to?to.version:null});d.close();showDetail(part.id);toast('儲位已更改');});};
 form.elements.archive.onclick=()=>submitForm(form,async()=>{if(!form.elements.confirmArchive.checked)throw Error('請先勾選移除確認');await warehouseCloud.mutate({action:'archiveStock',stockId:stock.id,expectedVersion:stock.version});d.close();showDetail(part.id);toast('存放記錄已移除，可在明細還原');});d.showModal();
}
function openStockRestore(part,stock){
 const d=$('#editDialog');d.innerHTML='<div class="dialog-head"><h2>還原存放位置</h2><button type="button" class="close">×</button></div><form class="dialog-body"><p>'+esc(locationPath(stock.locationId))+' · '+esc(quantityText(stock))+'</p><button class="primary">確認還原</button></form>';
 const form=d.querySelector('form');d.querySelector('.close').onclick=()=>{if(!form.dataset.busy)d.close();};d.oncancel=e=>{if(form.dataset.busy)e.preventDefault();};form.onsubmit=e=>{e.preventDefault();submitForm(form,async()=>{await warehouseCloud.mutate({action:'restoreStock',stockId:stock.id,expectedVersion:stock.version});d.close();showDetail(part.id);});};d.showModal();
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
$('#manualScanButton').onclick=()=>{const code=$('#manualScanCode').value.trim();if(code)finishScan(code);else toast('請先輸入編號');};
$('#manualScanCode').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#manualScanButton').click();}};
warehouseCloud.onMutationConfirmed=(command,result)=>{
  const {requestId,...payload}=command;
  for(const [mode,draft] of Object.entries(addDrafts))if(draft.uncertain&&draft.submittedCommand===JSON.stringify(payload)){
    delete addDrafts[mode];addMode=null;renderAdd();closeCreationDialog();toast('已確認建立結果，請勿重複新增');showDetail(result.result.id);break;
  }
};
warehouseCloud.onState=next=>{
  archivedStocks=next.stocks.filter(s=>s.status==='ARCHIVED');state={...next,stocks:next.stocks.filter(s=>s.status!=='ARCHIVED')};items=state.locations.map(x=>({...x})).concat(state.parts.map(x=>({...x,type:'item'})));
  detailGeneration++;['detailDialog','editDialog','quantityDialog'].forEach(id=>{const d=$('#'+id);if(d.open)d.close();});
  render(current);bindNavigation();
};
window.WarehouseUI={locationPath,pathOf,totalText,quantityText,descendants,scanResult};
bindNavigation();renderHome();
