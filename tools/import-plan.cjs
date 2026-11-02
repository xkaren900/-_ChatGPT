/* Builds deterministic import events from an approved dry run. No network or writes. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {migrationPlan}=require('./migration.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function buildImport(plan){
 if(plan.mode!=='DRY_RUN_ONLY'||!plan.readyForReview)throw Error('Only a resolved dry run can be imported');
 if(hash(plan.sourceArchive)!==plan.sourceSHA256)throw Error('Source archive hash does not match');
 const verified=migrationPlan(plan.sourceArchive);
 if(!verified.readyForReview||JSON.stringify(verified.proposed)!==JSON.stringify(plan.proposed))throw Error('Dry run no longer matches the source');
 const input=plan.sourceArchive,source=input.github||{},privateData=input.private||{};
 if(['parts','locations','stocks'].some(k=>privateData[k]?.length))throw Error('This importer is scoped to the selected GitHub source only');
 const sourceId=input.sourceMetadata?.githubSpreadsheetId;
 if(!sourceId)throw Error('Source spreadsheet provenance required');
 const context=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../backend/Core.gs'),'utf8'),context);
 const core=context.WarehouseCore,events=[];
 function commit(command,time,provenance,photoId=''){
  if(typeof time!=='string'||!Number.isFinite(Date.parse(time)))throw Error('Original timestamps must be normalized before import');
  const fingerprint=hash({...command,sourceSHA256:plan.sourceSHA256});
  const event=JSON.parse(JSON.stringify(core.plan(core.replay(events),command,{time,fingerprint,photoId})));
  event.actor='舊系統（共用金鑰）';event.migration={sourceSpreadsheetId:sourceId,sourceSHA256:plan.sourceSHA256,...provenance};
  if(JSON.stringify(event).length>45000)throw Error('Import event exceeds the journal cell limit');
  events.push(event);
 }
 const importedId=(type,id)=>'import-'+hash([sourceId,type,id]).slice(0,32);
 const pending=verified.proposed.locations.map(x=>({...x}));
 while(pending.length){
  const index=pending.findIndex(x=>x.parentId===null||core.replay(events).locations.some(p=>p.id===x.parentId));
  if(index<0)throw Error('Location graph is incomplete or cyclic');
  const [loc]=pending.splice(index,1);
  commit({action:'createLocation',requestId:importedId('location',loc.id),code:loc.id,input:{name:loc.name,type:loc.type,parentId:loc.parentId,status:loc.status,note:loc.note}},loc.createdAt,{kind:'location',originalId:loc.id},loc.photoId);
 }
 const history=source.history||[];
 for(const part of verified.proposed.parts){
  const stock=verified.proposed.stocks.find(x=>x.partId===part.id),records=history.filter(x=>(x.itemId||x.id)===part.id);
  const quantity=records.length?records[0].before:stock?.quantity;
  const command={action:'createPart',requestId:importedId('part',part.id),code:part.id,input:{name:part.name,manufacturer:part.manufacturer,mpn:part.mpn,specification:part.specification,unit:part.unit,barcode:part.barcode,note:part.note}};
  if(stock)command.initialStock={locationId:stock.locationId,quantity:quantity??null,quantityState:records.length?'KNOWN':stock.quantityState};
  commit(command,part.createdAt,{kind:'part-and-baseline',originalId:part.id,baselineSource:records.length?'before-first-legacy-event':'current-source-row'},part.photoId);
 }
 // Keep the original request IDs, row order, reasons and timestamps. The initial
 // baseline uses the first "before" value, never the current total plus history.
 for(const record of history){
  const partId=record.itemId||record.id,state=core.replay(events),stock=state.stocks.find(x=>x.partId===partId);
  if(!stock||stock.quantityState!=='KNOWN'||stock.quantity!==record.before)throw Error('Legacy history does not join the imported baseline');
  commit({action:'adjustQuantity',requestId:record.requestId,stockId:stock.id,expectedVersion:stock.version,operation:record.operation,amount:record.amount,reason:record.reason||''},record.time,{kind:'legacy-quantity',originalRequestId:record.requestId,sourceRow:record.sourceRow??null});
 }
 const state=JSON.parse(JSON.stringify(core.replay(events)));
 for(const expected of verified.proposed.stocks){
  const actual=state.stocks.find(x=>x.id===expected.id);
  if(!actual||actual.quantity!==expected.quantity||actual.quantityState!==expected.quantityState)throw Error('Imported quantity differs from the approved dry run');
 }
 const headers={
  WarehouseJournal:['EventJSON'],
  Parts:['id','code','name','manufacturer','mpn','specification','unit','barcode','note','status','photoId','createdAt','updatedAt','version'],
  Locations:['id','code','name','type','parentId','status','note','photoId','createdAt','updatedAt','version'],
  Stock:['id','partId','locationId','quantity','quantityState','updatedAt','version'],
  AuditLogs:['id','requestId','time','actor','action','reason','table','entityId','beforeJSON','afterJSON']
 };
 const rows={WarehouseJournal:events.map(event=>[JSON.stringify(event)])};
 for(const [table,records] of [['Parts',state.parts],['Locations',state.locations],['Stock',state.stocks]])rows[table]=records.map(record=>headers[table].map(field=>record[field]??''));
 rows.AuditLogs=events.flatMap(event=>event.changes.map((change,i)=>{
  const record={id:event.requestId+':'+i,requestId:event.requestId,time:event.time,actor:event.actor,action:event.action,reason:event.reason||'',table:change.table,entityId:change.after.id,beforeJSON:JSON.stringify(change.before),afterJSON:JSON.stringify(change.after)};
  return headers.AuditLogs.map(field=>record[field]??'');
 }));
 return {mode:'IMPORT_PAYLOAD_ONLY',sourceSpreadsheetId:sourceId,sourceSHA256:plan.sourceSHA256,events,state,headers,rows,
  counts:{parts:state.parts.length,locations:state.locations.length,stocks:state.stocks.length,events:events.length,legacyQuantityEvents:history.length},
  note:'Append new destination sheets only; retain original source sheets. This module never writes or deploys.'};
}
module.exports={buildImport};
if(require.main===module){if(!process.argv[2])throw Error('Usage: node tools/import-plan.cjs selected-plan.json');console.log(JSON.stringify(buildImport(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}
