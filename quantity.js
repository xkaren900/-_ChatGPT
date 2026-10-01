function openQuantityDialog(item) {
  const dialog=document.querySelector('#quantityDialog');
  const labels={increase:'增加',decrease:'減少',set:'盤點修正'};
  dialog.innerHTML=`<div class="dialog-head"><h2>數量調整 · ${esc(item.name)}</h2><button class="close" type="button">×</button></div><form class="dialog-body"><p>目前數量：<b>${item.quantity}</b></p><label>操作<select class="field" name="operation"><option value="increase">增加</option><option value="decrease">減少</option><option value="set">盤點修正</option></select></label><label class="top-sm" style="display:block"><span id="quantityLabel">增加數量</span><input class="field" name="amount" type="number" min="0" step="0.000001" required></label><label class="top-sm" style="display:block">原因（選填）<input class="field" name="reason" maxlength="500" placeholder="例如：補貨、領用、盤點"></label><p id="quantityPreview" role="status">請輸入數量</p><p id="quantityError" role="alert"></p><button class="primary" type="submit">確認調整</button><h3>最近50筆異動</h3><div id="quantityHistory">讀取中…</div></form>`;
  const form=dialog.querySelector('form'),error=dialog.querySelector('#quantityError'),submit=form.querySelector('button[type="submit"]');
  let pending=false,signature='',requestId='';
  function nextQuantity(){const amount=Number(form.elements.amount.value),operation=form.elements.operation.value;return Math.round((operation==='set'?amount:item.quantity+(operation==='increase'?amount:-amount))*1e6)/1e6}
  function preview(){dialog.querySelector('#quantityLabel').textContent=form.elements.operation.value==='set'?'實際清點數量':labels[form.elements.operation.value]+'數量';dialog.querySelector('#quantityPreview').textContent=form.elements.amount.value===''?'請輸入數量':`${item.quantity} → ${nextQuantity()}`}
  form.elements.operation.onchange=preview;form.elements.amount.oninput=preview;
  dialog.querySelector('.close').onclick=()=>{if(!pending)dialog.close()};dialog.oncancel=e=>{if(pending)e.preventDefault()};
  form.onsubmit=async event=>{
    event.preventDefault();if(pending)return;
    const amount=Number(form.elements.amount.value),operation=form.elements.operation.value,reason=form.elements.reason.value.trim();
    if(!Number.isFinite(amount)||amount<0||nextQuantity()<0||(operation!=='set'&&amount===0)||nextQuantity()===item.quantity){error.textContent='請確認輸入數量，調整後不得小於0且需與原數量不同';return}
    const key=JSON.stringify({amount,operation,reason});if(key!==signature){signature=key;requestId=crypto.randomUUID()}
    pending=true;submit.disabled=true;error.textContent='';form.querySelectorAll('input,select').forEach(x=>x.disabled=true);
    try{
      const result=await warehouseCloud.request({action:'adjustQuantity',id:item.id,operation,amount,reason,expectedQuantity:item.quantity,expectedVersion:item.quantityVersion||'',requestId});
      Object.assign(item,result.item);dialog.close();document.querySelector('#detailDialog').close();showDetail(item.id);toast(result.warning||'數量已更新');
    }catch(e){error.textContent=e.message==='不支援的操作'?'請先更新 Apps Script 並部署新版本以啟用數量調整':e.message}
    finally{pending=false;submit.disabled=false;form.querySelectorAll('input,select').forEach(x=>x.disabled=false)}
  };
  dialog.showModal();
  warehouseCloud.request({action:'quantityHistory',id:item.id}).then(result=>{
    if(!dialog.open)return;
    dialog.querySelector('#quantityHistory').innerHTML=result.records.length?result.records.map(r=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(labels[r.operation]||r.operation)}：${esc(r.before)} → ${esc(r.after)}</b><div>${esc(r.reason||'未填原因')}</div><small>${esc(new Date(r.time).toLocaleString('zh-TW'))}</small></div>`).join(''):'尚無異動紀錄';
  }).catch(e=>{if(dialog.open)dialog.querySelector('#quantityHistory').textContent=e.message==='不支援的操作'?'請更新 Apps Script 後端':e.message});
}
