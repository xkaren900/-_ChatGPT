function openQuantityDialog(part,stock) {
  if(!stock)return;
  const dialog=document.querySelector('#quantityDialog'),isUnknown=stock.quantityState==='UNKNOWN';
  dialog.innerHTML='<div class="dialog-head"><h2>數量調整 · '+esc(part.name)+'</h2><button class="close" type="button">×</button></div><form class="dialog-body"><p>'+esc(locationPath(stock.locationId))+'</p><p>目前：<b>'+esc(quantityText(stock))+'</b> '+esc(part.unit)+' · 版次 '+stock.version+'</p><label>操作<select class="field" name="operation"><option value="increase" '+(isUnknown?'disabled':'')+'>增加</option><option value="decrease" '+(isUnknown?'disabled':'')+'>減少</option><option value="set" '+(isUnknown?'selected':'')+'>盤點修正</option><option value="unknown" '+(isUnknown?'disabled':'')+'>標示數量未知</option></select></label><label>數量<input class="field" name="amount" type="number" min="0" max="1000000000000" step="0.000001" required></label><label>原因（選填）<input class="field" name="reason" maxlength="500"></label><p id="quantityPreview" role="status">請輸入數量</p><button class="primary" type="submit">確認調整</button><h3>最近50筆相關紀錄</h3><div id="quantityHistory">讀取中…</div></form>';
  const form=dialog.querySelector('form');
  function preview(){
    const unknown=form.elements.operation.value==='unknown';form.elements.amount.disabled=unknown;form.elements.amount.required=!unknown;
    if(unknown){dialog.querySelector('#quantityPreview').textContent='改為數量未知，不會當成0';return;}
    if(form.elements.amount.value===''){dialog.querySelector('#quantityPreview').textContent='請輸入數量';return;}
    const value=Number(form.elements.amount.value),operation=form.elements.operation.value;
    const next=operation==='set'?value:Math.round((stock.quantity+(operation==='increase'?value:-value))*1e6)/1e6;
    dialog.querySelector('#quantityPreview').textContent=quantityText(stock)+' → '+next+' '+part.unit;
  }
  form.elements.operation.onchange=form.elements.amount.oninput=preview;
  dialog.querySelector('.close').onclick=()=>{if(!form.dataset.busy)dialog.close();};
  dialog.oncancel=e=>{if(form.dataset.busy)e.preventDefault();};
  form.onsubmit=event=>{event.preventDefault();submitForm(form,async()=>{
    const operation=form.elements.operation.value;
    await warehouseCloud.mutate({action:'adjustQuantity',stockId:stock.id,expectedVersion:stock.version,operation,
      amount:operation==='unknown'?null:Number(form.elements.amount.value),reason:form.elements.reason.value});
    dialog.close();showDetail(part.id);toast('該儲位數量已更新');
  });};
  dialog.showModal();
  warehouseCloud.request({action:'history',id:stock.id}).then(result=>{
    if(dialog.open&&dialog.querySelector('form')===form)dialog.querySelector('#quantityHistory').innerHTML=historyHTML(result.records);
  }).catch(error=>{if(dialog.open&&dialog.querySelector('form')===form)dialog.querySelector('#quantityHistory').textContent=error.message;});
}
