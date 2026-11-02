/* Read-only, local export analysis. No Google SDK, network, or destination writes. */
const fs=require('node:fs'),crypto=require('node:crypto');
function migrationPlan(input){
 const parts=[],locations=[],stocks=[],issues=[],mapping=[],codes=new Map(),names=new Map();
 const sourceArchive=JSON.parse(JSON.stringify(input));
 function issue(code,source,id,message,blocking=true){issues.push({code,source,id,message,blocking});}
 function addCode(source,id){
  if(typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)){issue('INVALID_CODE',source,id,'既有編號不符合合併版格式，需人工決定QR保留策略');return false;}
  const key=id.toLowerCase();if(codes.has(key)){issue('CODE_COLLISION',source,id,'編號與'+codes.get(key)+'重複；不可自動重新編號');return false;}codes.set(key,source+':'+id);return true;
 }
 function nameCheck(part,source){
  const key=part.name.normalize('NFKC').trim().toLowerCase();
  if(names.has(key))issue('POSSIBLE_DUPLICATE',source,part.id,'同名物品保留不同主檔，需確認是否合併',false);
  names.set(key,part.id);
 }
 function stock(partId,locationId,value,source){
  const unknown=value===null||value===undefined||value==='';
  if(!unknown&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12||Math.abs(value-Math.round(value*1e6)/1e6)>1e-9)){
   issue('INVALID_QUANTITY',source,partId,'數量格式、精度或範圍無效，未轉成0');return;
  }
  const id=JSON.stringify([partId,locationId]);if(stocks.some(x=>x.id===id)){issue('DUPLICATE_STOCK',source,partId,'相同零件與儲位有重複庫存記錄');return;}
  stocks.push({id,partId,locationId,quantity:unknown?null:value,quantityState:unknown?'UNKNOWN':'KNOWN',version:1});
 }
 const github=input.github||{},history=github.history||[];
 const historyIDs=new Set();
 history.forEach(row=>{if(historyIDs.has(row.requestId))issue('DUPLICATE_LEGACY_REQUEST','github',row.requestId,'原數量紀錄包含重複識別碼');historyIDs.add(row.requestId);});
 for(const item of github.items||[]){
  const id=item.id||item.code;if(item.code&&item.id&&item.id!==item.code)issue('ID_CODE_MISMATCH','github',id,'id與QR不同，需人工映射');
  if(!addCode('github',id))continue;
  mapping.push({source:'github',oldId:id,newId:id});
  if(item.type==='item'){
   const part={id,code:id,name:String(item.name||''),manufacturer:item.manufacturer||'',mpn:item.mpn||'',specification:item.specification||'',unit:item.unit||'個',barcode:item.barcode||'',note:item.note||'',status:'ACTIVE',photoId:item.photoId||'',version:1,createdAt:item.createdAt||null};
   parts.push(part);nameCheck(part,'github');
   const records=history.filter(x=>x.itemId===id||x.id===id);
   for(let i=0;i<records.length;i++){
    if(i&&records[i].before!==records[i-1].after)issue('HISTORY_GAP','github',id,'數量異動前後不連續，需對帳');
   }
   const latest=records.at(-1);const value=latest?latest.after:item.quantity;
   if(latest&&item.quantity!==latest.after)issue('MASTER_LOG_DIFFERENCE','github',id,'主表與最後異動數量不同，預演採異動紀錄，需確認',false);
   stock(id,item.parent||null,value,'github');
  }else if(['room','cabinet','box'].includes(item.type)){
   locations.push({id,code:id,name:item.name||'',type:item.type,parentId:item.parent||null,status:item.status||'ACTIVE',note:item.note||'',photoId:item.photoId||'',version:1});
  }else issue('INVALID_TYPE','github',id,'未知節點種類');
 }
 const privateData=input.private||{};
 for(const item of privateData.parts||[]){
  const id=item.PartID;if(!addCode('private',id))continue;
  const part={id,code:id,name:String(item.PartName||''),manufacturer:item.Manufacturer||'',mpn:item.MPN||'',specification:item.Specification||'',unit:item.Unit||'個',barcode:item.Barcode||'',note:item.Notes||'',status:item.Status||'ACTIVE',photoId:'',version:Number(item.Version)||1,createdAt:item.CreatedAt||null};
  parts.push(part);mapping.push({source:'private',oldId:id,newId:id});nameCheck(part,'private');
 }
 for(const item of privateData.locations||[]){
  const id=item.LocationID;if(!addCode('private',id))continue;
  if(!['room','cabinet','box'].includes(item.LocationType))issue('LOCATION_TYPE_REQUIRED','private',id,'私人系統儲位種類未指定，需選房間／櫃子／箱子');
  locations.push({id,code:id,name:item.LocationName||'',type:item.LocationType||null,parentId:item.ParentID||null,status:item.Status||'ACTIVE',note:item.Description||'',photoId:'',version:Number(item.Version)||1});
  mapping.push({source:'private',oldId:id,newId:id});
 }
 for(const item of privateData.stocks||[])stock(item.PartID,item.LocationID||null,item.Quantity,'private');
 const locMap=new Map(locations.map(x=>[x.id,x]));
 locations.forEach(loc=>{
  if(loc.status==='ACTIVE'&&!String(loc.name).trim())issue('ACTIVE_NAME_REQUIRED','merged',loc.id,'啟用儲位沒有名稱');
  if(!['ACTIVE','RESERVED'].includes(loc.status))issue('INVALID_STATUS','merged',loc.id,'儲位狀態無效');
  if(loc.parentId&&!locMap.has(loc.parentId))issue('MISSING_PARENT','merged',loc.id,'上級儲位不存在');
  if(loc.parentId&&locMap.get(loc.parentId)?.status==='RESERVED')issue('RESERVED_PARENT','merged',loc.id,'預留儲位已有子節點，需人工確認');
  const seen=new Set([loc.id]);let next=loc.parentId;
  while(next&&locMap.has(next)){if(seen.has(next)){issue('CYCLE','merged',loc.id,'儲位階層含循環');break;}seen.add(next);next=locMap.get(next).parentId;}
 });
 stocks.forEach(s=>{
  if(!parts.some(p=>p.id===s.partId))issue('MISSING_PART','merged',s.id,'庫存找不到零件主檔');
  if(s.locationId&&!locMap.has(s.locationId))issue('MISSING_STOCK_LOCATION','merged',s.id,'庫存找不到儲位');
  if(s.locationId&&locMap.get(s.locationId)?.status!=='ACTIVE')issue('INACTIVE_STOCK_LOCATION','merged',s.id,'庫存位於未啟用儲位');
 });
 parts.concat(locations).forEach(item=>{
  if(/TEST-CODEX|測試|test/i.test(item.name+' '+item.note))issue('TEST_DATA_REVIEW','merged',item.id,'測試資料需決定排除或保留，不自動轉正式');
 });
 return {mode:'DRY_RUN_ONLY',readyForReview:!issues.some(x=>x.blocking),sourceSHA256:crypto.createHash('sha256').update(JSON.stringify(sourceArchive)).digest('hex'),
  counts:{parts:parts.length,locations:locations.length,stocks:stocks.length,legacyQuantityRecords:history.length},mapping,issues,proposed:{parts,locations,stocks},sourceArchive,
  limitations:['不寫入目的地、不合併同名物品、不修改QR或照片權限','原歷史完整封存；實際匯入工具與資料切換尚未開放','輸入的github.history需依原始順序提供全部紀錄，不限於畫面最近50筆','未指定位置保留null，不擅自搬入任意抽屜']};
}
module.exports={migrationPlan};
if(require.main===module){if(!process.argv[2])throw Error('Usage: node tools/migration.cjs export.json');console.log(JSON.stringify(migrationPlan(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}
