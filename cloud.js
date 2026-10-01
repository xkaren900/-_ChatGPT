// 金鑰只保留在記憶體，重新整理頁面後需再次輸入。
const warehouseCloud = (() => {
  const endpoint = 'https://script.google.com/macros/s/AKfycbzUXvK723SxffegEGG17uqnT4hUjdrbg9AtkOdgB1tn8xXLS-GazT9mwh33na0s4LWB/exec';
  let token = '', busy = false;
  const api = {onItems: null, request, refresh};
  function status(message) { document.querySelector('#cloudStatus').textContent = message; }
  async function request(payload) {
    if (!token) throw new Error('請先連接雲端');
    let response;
    try {
      response = await fetch(endpoint, {method:'POST',redirect:'follow',credentials:'omit',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token})});
    } catch (error) {
      throw new Error(payload.action === 'create' || payload.action === 'move' ? '未收到雲端確認，請重新載入確認結果後再操作' : '無法連接雲端，請檢查網路及部署設定');
    }
    if (!response.ok) throw new Error('雲端回應失敗，請重新載入確認資料');
    let result;
    try { result = await response.json(); } catch (error) { throw new Error('後端未回傳JSON，請確認已部署正確版本及存取權'); }
    if (!result.ok) throw new Error(result.error || '雲端操作失敗');
    return result;
  }
  async function refresh() {
    if (busy) return;
    busy = true; controls(); status('正在讀取雲端資料…');
    try {
      const result = await request({action:'list'});
      if (!Array.isArray(result.items)) throw new Error('雲端資料格式錯誤');
      api.onItems?.(result.items);
      status('雲端已連接 · '+result.items.length+' 個項目');
    } catch (error) { status(error.message); throw error; }
    finally { busy = false; controls(); }
  }
  function controls() {
    document.querySelector('#cloudConnect').disabled = busy;
    document.querySelector('#cloudRefresh').disabled = busy || !token;
    document.querySelector('#cloudDisconnect').disabled = busy || !token;
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#cloudConnect').onclick = async () => {
      const dialog=document.createElement('dialog');
      dialog.innerHTML='<form class="dialog-body"><h2>連接雲端</h2><label>存取金鑰<input class="field" type="password" autocomplete="off" required minlength="24"></label><p>輸入你設定的 WAREHOUSE_TOKEN，僅保留於本次頁面。</p><button class="primary">連接</button> <button class="secondary" type="button">取消</button></form>';
      document.body.append(dialog);dialog.showModal();
      const close=()=>{dialog.close();dialog.remove()};
      dialog.querySelector('button.secondary').onclick=close;
      dialog.oncancel=()=>dialog.remove();
      dialog.querySelector('form').onsubmit=async event=>{
        event.preventDefault();token=dialog.querySelector('input').value;close();
        try{await refresh()}catch(error){token='';api.onItems?.([]);controls()}
      };
    };
    document.querySelector('#cloudRefresh').onclick=()=>refresh().catch(()=>{});
    document.querySelector('#cloudDisconnect').onclick=()=>{token='';api.onItems?.([]);status('尚未連接雲端');controls()};
    controls();
  });
  return api;
})();
