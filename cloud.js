/* Shared-key connection. Never points the merge candidate at the legacy database. */
const warehouseCloud = (() => {
  const config = window.WAREHOUSE_CONFIG || {};
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const endpoint = config.endpoint || '';
  const key = 'warehouse-token:' + endpoint, pendingKey = 'warehouse-pending-v4:' + endpoint;
  const backend = preview ? createWarehousePreview() : null;
  let token = '', busy = false, pending = null;
  const api = {onState:null, onMutationConfirmed:null, request, refresh, mutate, resolvePending, isPreview:preview};
  const status = message => { document.querySelector('#cloudStatus').textContent = message; };
  function stored() { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function forget() { try { localStorage.removeItem(key); return true; } catch (_) { return false; } }
  function rememberPending(command) {
    if (!preview) sessionStorage.setItem(pendingKey, JSON.stringify(command));
    pending = command;
  }
  function clearPending() {
    pending = null;
    if (!preview) { try { sessionStorage.removeItem(pendingKey); } catch (_) { status('操作已確認，但無法清除本機待確認記錄'); } }
  }
  function controls() {
    document.querySelector('#cloudConnect').disabled = busy || preview || !endpoint;
    document.querySelector('#cloudRefresh').disabled = busy || (!token && !preview);
    document.querySelector('#cloudDisconnect').disabled = busy || (!token && !preview) || preview;
    document.querySelector('#cloudForget').disabled = busy || preview || !stored();
    document.querySelector('#cloudResolve').hidden = !pending;
    document.querySelector('#cloudResolve').disabled = busy;
  }
  async function request(payload) {
    if (preview) return backend.request(payload);
    if (!endpoint) throw new Error('此版本尚未設定雲端連線');
    if (!token) throw new Error('請先連接雲端');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),45000);
    const writing = !['list','history','health','photo','requestStatus'].includes(payload.action);
    let received = false;
    try {
      const response = await fetch(endpoint,{method:'POST',redirect:'follow',credentials:'omit',signal:controller.signal,
        headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,schema:4,token})});
      if (!response.ok) throw new Error('雲端暫時無法回應');
      const result = await response.json();
      if (result.schema !== 4) throw new Error('網站與雲端版本不一致，請停止操作並確認更新');
      received = true;
      if (!result.ok) {
        const error = new Error(result.error || '操作失敗');
        error.uncertain = !!result.outcomeUnknown;
        if (result.error === '未授權') {
          // A prior timed-out attempt may already be committed under the old key.
          if (writing) error.uncertain = true;
          token = ''; forget(); api.onState?.({schema:4,parts:[],locations:[],stocks:[]});
        }
        throw error;
      }
      return result;
    } catch (error) {
      if (writing && !received) {
        error.uncertain = true;
        error.message = '尚未確認操作結果；請按「確認上次操作」，不要再次建立相同操作';
      }
      throw error;
    } finally { clearTimeout(timer); controls(); }
  }
  async function refresh() {
    if (busy) throw new Error('請等候目前操作完成');
    busy = true; controls(); status(preview ? '本機預覽：資料僅存於本頁，重新整理即重設' : '正在讀取資料…');
    try {
      const result = await request({action:'list'});
      if (!result.state || !Array.isArray(result.state.parts) || !Array.isArray(result.state.stocks) || !Array.isArray(result.state.locations)) throw new Error('雲端資料格式錯誤');
      api.onState?.(result.state);
      status(preview ? '本機預覽 · 資料不會上傳，重新整理即重設' : '已連接 · '+result.state.parts.length+' 種零件');
    } catch (error) { status(error.message); throw error; }
    finally { busy = false; controls(); }
  }
  async function sendPending() {
    busy = true; controls();status(pending.action.startsWith('create')?'新增中…請稍候':'儲存中…請稍候');
    try {
      const command=pending,result = await request(command);
      // Once acknowledged, do not turn a refresh failure into a second mutation.
      clearPending(); busy = false;
      await refresh().catch(() => status('操作已提交，但尚未讀回最新資料；請重新載入'));
      if (result.warning) status(result.warning);
      api.onMutationConfirmed?.(command,result);
      return result;
    } catch (error) {
      if (!error.uncertain) clearPending();
      status(error.message); throw error;
    } finally { busy = false; controls(); }
  }
  async function mutate(command) {
    if (busy) throw new Error('請等候目前操作完成');
    if (pending) throw new Error('上次操作結果尚未確認，請先按「確認上次操作」');
    try { rememberPending({...command,requestId:crypto.randomUUID()}); }
    catch (_) { throw new Error('無法保存待確認操作，尚未送出；請確認瀏覽器儲存空間或縮小照片'); }
    return sendPending();
  }
  async function resolvePending() {
    if (busy) return;
    if (!pending) return;
    // Same exact payload and RequestID. Backend replays success or executes once.
    return sendPending();
  }
  document.addEventListener('DOMContentLoaded', () => {
    try { pending = preview ? null : JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch (_) { pending = null; }
    document.querySelector('#cloudConnect').onclick = () => {
      const dialog = document.createElement('dialog');
      dialog.innerHTML = '<form class="dialog-body"><h2>連接雲端</h2><label>存取金鑰<input class="field" type="password" autocomplete="off" required minlength="24"></label><label><input type="checkbox" name="remember"> 記住這台裝置</label><p>僅在私人裝置勾選。共用金鑰不會辨識個人身分。</p><button class="primary">連接</button> <button type="button" class="secondary">取消</button></form>';
      document.body.append(dialog); dialog.showModal();
      const close = () => { dialog.close(); dialog.remove(); };
      dialog.querySelector('.secondary').onclick = close; dialog.oncancel = () => dialog.remove();
      dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        token = dialog.querySelector('input[type=password]').value;
        const remember = dialog.querySelector('[name=remember]').checked; close();
        try {
          await refresh();
          if (remember) { try { localStorage.setItem(key,token); } catch (_) { status('已連接，但無法記住金鑰'); } }
          else if (!forget()) status('已連接，但無法清除先前儲存的金鑰，請清除本站資料');
        } catch (_) { token = ''; }
        controls();
      };
    };
    document.querySelector('#cloudRefresh').onclick = () => refresh().catch(() => {});
    document.querySelector('#cloudResolve').onclick = () => resolvePending().catch(() => {});
    document.querySelector('#cloudDisconnect').onclick = () => { token=''; api.onState?.({schema:4,parts:[],locations:[],stocks:[]}); status('已中斷連線'); controls(); };
    document.querySelector('#cloudForget').onclick = () => {
      if (!forget()) return status('無法清除金鑰，請清除本站儲存資料');
      token=''; api.onState?.({schema:4,parts:[],locations:[],stocks:[]}); status('已忘記金鑰；待確認操作仍保留'); controls();
    };
    token = stored(); controls();
    if (preview || token) refresh().catch(() => {});
    else status(endpoint ? '尚未連接雲端' : '合併開發版 · 尚未連接資料庫');
  });
  return api;
})();
