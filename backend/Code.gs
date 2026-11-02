/* Schema 4 adapter. Install Core.gs alongside this file in a NEW test project. */
const MERGED_HEADERS = {
  WarehouseJournal: ['EventJSON'],
  Parts: ['id','code','name','manufacturer','mpn','specification','unit','barcode','note','status','photoId','createdAt','updatedAt','version'],
  Locations: ['id','code','name','type','parentId','status','note','photoId','createdAt','updatedAt','version'],
  Stock: ['id','partId','locationId','quantity','quantityState','updatedAt','version','status'],
  AuditLogs: ['id','requestId','time','actor','action','reason','table','entityId','beforeJSON','afterJSON']
};
function mergedConfig_() {
  const props = PropertiesService.getScriptProperties();
  const deployment = typeof MERGED_DEPLOYMENT_CONFIG === 'undefined' ? {} : MERGED_DEPLOYMENT_CONFIG;
  const spreadsheetId = props.getProperty('MERGED_SPREADSHEET_ID') || deployment.spreadsheetId;
  if (!spreadsheetId) throw new Error('尚未設定合併版資料庫');
  return {props, spreadsheetId, folderId: props.getProperty('MERGED_PHOTO_FOLDER_ID') || deployment.folderId || '', deployment};
}
function mergedEnabled_(config) {
  const setting = config.props.getProperty('MERGED_WRITE_ENABLED');
  if (setting !== 'true' && !(setting === null && config.deployment && config.deployment.writeEnabled === true)) throw new Error('此資料庫目前禁止寫入');
}
function setupMergedWarehouse() {
  const config = mergedConfig_(); mergedEnabled_(config);
  const token = config.props.getProperty('WAREHOUSE_TOKEN');
  if (!token || token.length < 24) throw new Error('請先設定至少24字元的共用金鑰');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const book = SpreadsheetApp.openById(config.spreadsheetId);
    // Never initialize over an existing inventory workbook. Use a separate destination.
    const allowed = Object.keys(MERGED_HEADERS).concat(['工作表1','Sheet1','工作表 1']);
    if (book.getSheets().some(s => !allowed.includes(s.getName()) || (!MERGED_HEADERS[s.getName()] && s.getLastRow() > 0))) {
      throw new Error('初始化只能使用獨立空白資料庫或已初始化的合併版資料庫');
    }
    for (const [name, headers] of Object.entries(MERGED_HEADERS)) {
      let sheet = book.getSheetByName(name);
      if (!sheet) sheet = book.insertSheet(name);
      if (!sheet.getLastRow()) {
        sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1);
      }
      mergedSheet_(book, name);
    }
    SpreadsheetApp.flush();
    console.log(JSON.stringify({ok:true,schema:4,sheets:Object.keys(MERGED_HEADERS)}));
  } finally { lock.releaseLock(); }
}
function mergedSheet_(book, name) {
  const sheet = book.getSheetByName(name), headers = MERGED_HEADERS[name];
  if (!sheet || sheet.getRange(1,1,1,headers.length).getDisplayValues()[0].some((v,i) => v !== headers[i])) {
    throw new Error('合併版資料表欄位不符：' + name);
  }
  return sheet;
}
function mergedEvents_(book) {
  const sheet = mergedSheet_(book, 'WarehouseJournal');
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().map(row => {
    if (typeof row[0] !== 'string' || !row[0].startsWith('{')) throw new Error('提交日誌格式錯誤');
    return JSON.parse(row[0]);
  });
}
function mergedCanonical_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(mergedCanonical_).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + mergedCanonical_(value[k])).join(',') + '}';
}
function mergedFingerprint_(command) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, mergedCanonical_(command), Utilities.Charset.UTF_8);
  return bytes.map(x => ((x+256)%256).toString(16).padStart(2,'0')).join('');
}
function mergedAutoCode_(state, command, config) {
  const prefix = command.action === 'createPart' ? 'ITM' : ({room:'LOC',cabinet:'CAB',box:'BOX'}[command.input && command.input.type]);
  if (!prefix) throw new Error('儲位種類無效');
  const stem = prefix + '-' + Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd') + '-';
  let max = 0;
  state.parts.concat(state.locations).forEach(x => {
    if (x.id.startsWith(stem) && /^\d+$/.test(x.id.slice(stem.length))) max = Math.max(max,Number(x.id.slice(stem.length)));
  });
  const key = 'MERGED_CODE.' + config.spreadsheetId + '.' + stem;
  const saved = config.props.getProperty(key);
  if (saved !== null && !/^\d+$/.test(saved)) throw new Error('編號計數器格式錯誤');
  const next = Math.max(max, Number(saved || 0)) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('編號超出安全範圍');
  config.props.setProperty(key,String(next));
  return stem + String(next).padStart(4,'0');
}
function mergedPhoto_(command, config) {
  if (!command.photo) return '';
  if (!['createPart','createLocation'].includes(command.action)) throw new Error('此操作不支援上傳照片');
  if (!config.folderId) throw new Error('尚未設定私人照片資料夾');
  const match = String(command.photo).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > 2800000) throw new Error('照片格式錯誤或超過2MB');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 2100000) throw new Error('照片超過2MB');
  const folder = DriveApp.getFolderById(config.folderId);
  const name = 'merged-' + command.requestId + '.' + match[1].split('/')[1];
  const files = folder.getFilesByName(name);
  if (files.hasNext()) return files.next().getId();
  // Keep original Drive permissions; never make public. A failed commit may leave an orphan for review.
  return folder.createFile(Utilities.newBlob(bytes,match[1],name)).getId();
}
function mergedProject_(book, state, events) {
  function upsert(name, rows) {
    const sheet = mergedSheet_(book, name), fields = MERGED_HEADERS[name];
    const indexes = new Map();
    if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues().forEach((r,i) => {
      if (indexes.has(r[0])) throw new Error('投影資料包含重複編號'); indexes.set(r[0],i+2);
    });
    rows.forEach(row => {
      const number = indexes.get(row.id) || sheet.getLastRow()+1;
      const values = fields.map(field => field === 'status' ? (row[field] || 'ACTIVE') : row[field] === null || row[field] === undefined ? '' : String(row[field]));
      // Sheets parses RichText input too. Escape every cell once, including genuine apostrophes.
      // Sheets consumes the escape on write; API reads canonical JSON with no unescape heuristic.
      const range = sheet.getRange(number,1,1,fields.length);
      range.setNumberFormat('@');
      range.setRichTextValues([values.map(value => SpreadsheetApp.newRichTextValue().setText("'" + value).build())]);
      indexes.set(row.id,number);
    });
  }
  upsert('Parts',state.parts); upsert('Locations',state.locations); upsert('Stock',state.stocks);
  const audit = [];
  events.forEach(event => event.changes.forEach((change,i) => audit.push({
    id:event.requestId+':'+i, requestId:event.requestId, time:event.time, actor:event.actor,
    action:event.action, reason:event.reason || '', table:change.table, entityId:change.after.id,
    beforeJSON:JSON.stringify(change.before), afterJSON:JSON.stringify(change.after)
  })));
  upsert('AuditLogs',audit); SpreadsheetApp.flush();
}
function doGet() { return mergedJSON_({ok:true,service:'warehouse-merged',schema:4}); }
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 3000000) throw new Error('請求內容無效或過大');
    const body = JSON.parse(e.postData.contents), config = mergedConfig_();
    const token = config.props.getProperty('WAREHOUSE_TOKEN');
    if (!token || token.length < 24 || body.token !== token) throw new Error('未授權');
    if (body.schema !== 4) throw new Error('前後端版本不一致，請重新載入');
    const command = {...body}; delete command.token;
    const book = SpreadsheetApp.openById(config.spreadsheetId);
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) throw new Error('系統忙碌，尚未開始寫入，請稍後再試');
    const events = mergedEvents_(book), state = WarehouseCore.replay(events);
    if (command.action === 'list') return mergedJSON_({ok:true,schema:4,state});
    if (command.action === 'health') {
      Object.keys(MERGED_HEADERS).forEach(name => mergedSheet_(book,name));
      return mergedJSON_({ok:true,schema:4,events:events.length,parts:state.parts.length,locations:state.locations.length,stocks:state.stocks.length});
    }
    if (command.action === 'history') {
      const records = events.filter(event => event.changes.some(c => c.after.id === command.id));
      return mergedJSON_({ok:true,schema:4,records:records.slice(-50).reverse().map(event => ({
        requestId:event.requestId,time:event.time,actor:event.actor,action:event.action,reason:event.reason,changes:event.changes
      }))});
    }
    if (command.action === 'requestStatus') {
      const event = events.find(x => x.requestId === command.requestId);
      return mergedJSON_({ok:true,schema:4,committed:!!event,result:event ? event.result : null});
    }
    if (command.action === 'photo') {
      const item = state.parts.concat(state.locations).find(x => x.id === command.id);
      if (!item || !item.photoId || !config.folderId) throw new Error('找不到照片');
      const file = DriveApp.getFileById(item.photoId), parents = file.getParents();
      let allowed = false;
      while (parents.hasNext()) if (parents.next().getId() === config.folderId) allowed = true;
      if (!allowed) throw new Error('照片不在指定私人資料夾');
      const blob = file.getBlob();
      if (!/^image\/(jpeg|png|webp)$/.test(blob.getContentType()) || blob.getBytes().length > 2100000) throw new Error('照片格式或大小無效');
      return mergedJSON_({ok:true,schema:4,photo:'data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes())});
    }
    mergedEnabled_(config);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(String(command.requestId || ''))) throw new Error('請求識別碼無效');
    const fingerprint = mergedFingerprint_(command);
    const previous = events.find(x => x.requestId === command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('相同請求識別碼不可使用不同內容');
      return mergedJSON_({ok:true,schema:4,result:previous.result,replayed:true});
    }
    const generatedCode = !command.code && ['createPart','createLocation'].includes(command.action) ? mergedAutoCode_(state,command,config) : '';
    const event = WarehouseCore.plan(state,command,{time:new Date().toISOString(),fingerprint,generatedCode});
    const photoId = mergedPhoto_(command,config);
    if (photoId) { event.changes[0].after.photoId = photoId; event.result.photoId = photoId; }
    const json = JSON.stringify(event);
    if (json.length > 45000) throw new Error('此操作內容過大，請縮短備註');
    try {
      // One append is the commit boundary. Master tables and audit are rebuildable projections.
      // Do not acknowledge success before flush. A lost acknowledgement is NOT a rollback.
      mergedSheet_(book,'WarehouseJournal').appendRow([json]); SpreadsheetApp.flush();
    } catch (error) {
      return mergedJSON_({ok:false,schema:4,outcomeUnknown:true,requestId:command.requestId,error:'未取得提交確認，請使用原請求重試或查詢結果，不要建立新請求'});
    }
    let warning = '';
    try { mergedProject_(book,WarehouseCore.replay(events.concat([event])),events.concat([event])); }
    catch (error) { warning = '操作已提交；資料表顯示副本待重建，請以網站讀取結果為準'; }
    return mergedJSON_({ok:true,schema:4,result:event.result,warning});
  } catch (error) { return mergedJSON_({ok:false,schema:4,error:error.message || '操作失敗'}); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
function rebuildMergedProjections() {
  const config = mergedConfig_(); mergedEnabled_(config);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const book = SpreadsheetApp.openById(config.spreadsheetId), events = mergedEvents_(book);
    mergedProject_(book,WarehouseCore.replay(events),events);
  } finally { lock.releaseLock(); }
}
function mergedJSON_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function verifyMergedWarehouse() {
  const config = mergedConfig_(), book = SpreadsheetApp.openById(config.spreadsheetId);
  Object.keys(MERGED_HEADERS).forEach(name => mergedSheet_(book,name));
  const events = mergedEvents_(book), state = WarehouseCore.replay(events);
  const token = config.props.getProperty('WAREHOUSE_TOKEN') || '';
  console.log(JSON.stringify({ok:true,schema:4,events:events.length,parts:state.parts.length,locations:state.locations.length,stocks:state.stocks.length,quantities:state.stocks.map(s=>s.quantity),tokenConfigured:token.length>=24}));
}
