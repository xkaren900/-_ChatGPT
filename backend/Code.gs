// 貼入 Apps Script。先在「專案設定 → 指令碼屬性」設定 WAREHOUSE_TOKEN。
const WAREHOUSE = {
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  folderId: 'YOUR_PHOTO_FOLDER_ID',
  sheetName: '工作表1',
  headers: ['物品編號','物品種類','物品名稱','數量','位置條碼','照片預覽','照片連結','建檔時間','備註','照片檔案ID']
};

function setupWarehouse() {
  const token = PropertiesService.getScriptProperties().getProperty('WAREHOUSE_TOKEN');
  if (!token || token.length < 24) throw new Error('請先設定至少24字元的 WAREHOUSE_TOKEN 指令碼屬性');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(WAREHOUSE.spreadsheetId).getSheetByName(WAREHOUSE.sheetName);
    if (!sheet) throw new Error('找不到工作表1');
    const existing = sheet.getRange(1,1,1,8).getDisplayValues()[0];
    if (existing.some((v,i) => v !== WAREHOUSE.headers[i])) throw new Error('前8欄與預期欄位不符，未修改資料');
    const extra = sheet.getRange(1,9,1,2).getDisplayValues()[0];
    if (extra.some((v,i) => v && v !== WAREHOUSE.headers[i+8])) throw new Error('I/J欄已有其他用途，未修改資料');
    sheet.getRange(1,9,1,2).setValues([WAREHOUSE.headers.slice(8)]);
    quantityLog_(SpreadsheetApp.openById(WAREHOUSE.spreadsheetId),true);
    DriveApp.getFolderById(WAREHOUSE.folderId).getName();
    Logger.log('初始化完成；原有8欄保留，新增備註與照片檔案ID。');
  } finally { lock.releaseLock(); }
}

function doGet() { return json_({ok:true,service:'warehouse',version:3}); }
function doPost(e) {
  let lock;
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('WAREHOUSE_TOKEN');
    if (!token || token.length < 24 || body.token !== token) throw new Error('未授權');
    if (['create','move','adjustQuantity'].includes(body.action)) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) throw new Error('系統正在處理其他寫入，請稍後再試；此次尚未開始寫入');
    }
    const book = SpreadsheetApp.openById(WAREHOUSE.spreadsheetId);
    const sheet = book.getSheetByName(WAREHOUSE.sheetName);
    if (!sheet || sheet.getRange(1,1,1,10).getDisplayValues()[0].some((v,i) => v !== WAREHOUSE.headers[i])) throw new Error('請先執行 setupWarehouse');
    const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
    const items = rows.filter(r => r[0]).map(rowToItem_);
    const log = quantityLog_(book,false);
    const history = log && log.getLastRow()>1 ? log.getRange(2,1,log.getLastRow()-1,9).getValues() : [];
    const latest = new Map();history.forEach(r=>latest.set(String(r[1]),r));
    items.forEach(item=>{const entry=latest.get(item.id);item.quantityVersion=entry?String(entry[0]):'';if(entry)item.quantity=Number(entry[6])});
    if (body.action === 'list') return json_({ok:true,items:items});
    if (body.action === 'quantityHistory') return json_({ok:true,records:history.filter(r=>String(r[1])===body.id).slice(-50).reverse().map(r=>({requestId:r[0],operation:r[3],amount:r[4],before:r[5],after:r[6],reason:String(r[7]||'').replace(/^'(?=[=+@\-])/,'') ,time:r[8] instanceof Date?r[8].toISOString():String(r[8])}))});
    if (body.action === 'adjustQuantity') {
      if (!log) throw new Error('後端尚未初始化數量功能，請執行 setupWarehouse');
      const item=items.find(x=>x.id===body.id);
      if (!item || item.type!=='item') throw new Error('僅一般物品可調整數量');
      if (!/^[a-zA-Z0-9-]{16,100}$/.test(String(body.requestId||''))) throw new Error('異動識別碼無效');
      const previous=history.find(r=>String(r[0])===body.requestId);
      if(previous){if(String(previous[1])!==item.id || previous[3]!==body.operation || Number(previous[4])!==Number(body.amount))throw new Error('異動識別碼已使用');return json_({ok:true,item:item,replayed:true})}
      if (body.expectedQuantity!==item.quantity || String(body.expectedVersion||'')!==item.quantityVersion) throw new Error('數量已被其他裝置修改，請重新載入');
      const next=adjustedQuantity_(item.quantity,body.operation,body.amount),reason=String(body.reason||'').trim();
      if(reason.length>500)throw new Error('原因不得超過500字');
      // 異動紀錄為數量依據，主表是可重建的最新值；避免跨工作表部分寫入造成重複扣庫。
      log.appendRow([body.requestId,item.id,text_(item.name),body.operation,Number(body.amount),item.quantity,next,text_(reason),new Date()]);
      SpreadsheetApp.flush();
      let warning='';
      try {sheet.getRange(rows.findIndex(r=>String(r[0])===item.id)+2,4).setValue(next);SpreadsheetApp.flush()}catch(error){warning='異動已記錄，主表數量待重新同步'}
      return json_({ok:true,item:Object.assign({},item,{quantity:next,quantityVersion:body.requestId}),warning:warning});
    }
    if (body.action === 'photo') {
      const item = items.find(x => x.id === body.id);
      if (!item || !item.photoId) throw new Error('找不到照片');
      const file = DriveApp.getFileById(item.photoId), parents = file.getParents();
      let allowed = false;
      while (parents.hasNext()) if (parents.next().getId() === WAREHOUSE.folderId) allowed = true;
      if (!allowed) throw new Error('照片不在指定資料夾');
      const blob = file.getBlob();
      return json_({ok:true,photo:'data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes())});
    }
    if (body.action === 'create') {
      const input = body.item || {}, name = String(input.name || '').trim();
      if (!name || name.length > 200) throw new Error('名稱必填且不得超過200字');
      if (!['room','cabinet','box','item'].includes(input.type)) throw new Error('物品種類無效');
      const parent = input.parent || null;
      validateParent_(items,parent);
      const code = String(input.code || Utilities.getUuid()).trim();
      if (!/^[\w\-]{1,100}$/.test(code)) throw new Error('編號只接受英文、數字、底線及連字號');
      if (items.some(x => x.code.toLowerCase() === code.toLowerCase())) throw new Error('編號已使用');
      const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error('數量必須為非負數');
      const note = String(input.note || '');
      if (note.length > 5000) throw new Error('備註不得超過5000字');
      let file = null;
      if (input.photo) {
        const match = String(input.photo).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!match || match[2].length > 2800000) throw new Error('照片需為JPEG、PNG或WebP且小於2MB');
        file = DriveApp.getFolderById(WAREHOUSE.folderId).createFile(Utilities.newBlob(Utilities.base64Decode(match[2]),match[1],code+'.'+match[1].split('/')[1]));
      }
      try {
        const row = [code,input.type,text_(name),quantity,parent || '','',file ? file.getUrl() : '',new Date(),text_(note),file ? file.getId() : ''];
        sheet.appendRow(row);
        SpreadsheetApp.flush();
        return json_({ok:true,item:rowToItem_(row)});
      } catch (error) { if (file) file.setTrashed(true); throw error; }
    }
    if (body.action === 'move') {
      const item = items.find(x => x.id === body.id);
      if (!item) throw new Error('找不到物品');
      validateParent_(items,body.parent || null);
      let node = items.find(x => x.id === body.parent), seen = new Set();
      while (node) {
        if (node.id === item.id || seen.has(node.id)) throw new Error('不能移入自己或下層內容物');
        seen.add(node.id); node = items.find(x => x.id === node.parent);
      }
      if (body.expectedParent !== item.parent) throw new Error('位置已被其他裝置修改，請重新載入');
      const index = rows.findIndex(r => String(r[0]) === item.id);
      sheet.getRange(index+2,5).setValue(body.parent || '');
      SpreadsheetApp.flush();
      return json_({ok:true,item:Object.assign({},item,{parent:body.parent || null})});
    }
    throw new Error('不支援的操作');
  } catch (error) { return json_({ok:false,error:error.message || '操作失敗'}); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
function validateParent_(items,id) {
  if (id && !items.some(x => x.id === id && x.type !== 'item')) throw new Error('上級位置不存在或不是容器');
}
function text_(value) { return /^[=+@\-]/.test(value) ? "'"+value : value; }
function rowToItem_(r) {
  const clean = value => String(value || '').replace(/^'(?=[=+@\-])/,'');
  return {id:String(r[0]),code:String(r[0]),type:String(r[1]),name:clean(r[2]),quantity:Number(r[3]),parent:r[4] ? String(r[4]) : null,photo:'',photoUrl:String(r[6] || ''),createdAt:r[7] instanceof Date ? r[7].toISOString() : String(r[7] || ''),note:clean(r[8]),photoId:String(r[9] || '')};
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function quantityLog_(book,create) {
  const headers=['異動識別碼','物品編號','物品名稱','操作','輸入數量','異動前數量','異動後數量','原因','時間'];
  let sheet=book.getSheetByName('數量異動紀錄');
  if(!sheet&&create){sheet=book.insertSheet('數量異動紀錄');sheet.getRange(1,1,1,9).setValues([headers]);sheet.setFrozenRows(1)}
  if(sheet&&sheet.getRange(1,1,1,9).getDisplayValues()[0].some((v,i)=>v!==headers[i]))throw new Error('數量異動紀錄欄位不符');
  return sheet;
}
function adjustedQuantity_(before,operation,amount) {
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e12)throw new Error('數量必須為有效非負數');
  if(!['increase','decrease','set'].includes(operation))throw new Error('數量操作無效');
  if(operation!=='set'&&amount===0)throw new Error('增加或減少數量必須大於0');
  const next=Math.round((operation==='set'?amount:before+(operation==='increase'?amount:-amount))*1e6)/1e6;
  if(!Number.isFinite(before)||before<0||next<0||next>1e12)throw new Error('調整後數量不得小於0或超過上限');
  if(next===before)throw new Error('數量未改變');
  return next;
}
