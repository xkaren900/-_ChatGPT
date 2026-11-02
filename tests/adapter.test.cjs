const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {root}=require('./helpers.cjs');
function service(){
 const tables=new Map(),props=new Map([['MERGED_SPREADSHEET_ID','TEST-DESTINATION'],['MERGED_WRITE_ENABLED','true'],['WAREHOUSE_TOKEN','test-only-key-at-least-24-characters']]);
 const faults={append:null,projection:false,flush:false};let held=false;
 function sheet(name){
  const rows=[];const s={rows,getName:()=>name,getLastRow:()=>rows.length,setFrozenRows:()=>{},
   getRange:(row,col,count,width)=>({getValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>rows[row+i-1]?.[col+j-1]??'')),
    getDisplayValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>String(rows[row+i-1]?.[col+j-1]??''))),
    setValues:values=>{assert.equal(held,true);values.forEach((r,i)=>{rows[row+i-1]||=[];r.forEach((v,j)=>rows[row+i-1][col+j-1]=v);});},
    setRichTextValues:values=>{assert.equal(held,true);if(faults.projection){faults.projection=false;throw Error('projection fault');}values.forEach((r,i)=>{rows[row+i-1]||=[];r.forEach((v,j)=>{assert.equal(v.literal,true);rows[row+i-1][col+j-1]=v.value;});});}
   }),
   appendRow:row=>{
    assert.equal(held,true);
    if(faults.append==='before'){faults.append=null;throw Error('before append');}
    rows.push(row.slice());
    if(faults.append==='after'){faults.append=null;throw Error('lost append acknowledgement');}
   }
  };tables.set(name,s);return s;
 }
 const book={getSheetByName:n=>tables.get(n)||null,getSheets:()=>[...tables.values()],insertSheet:sheet};
 const context=vm.createContext({console:{log:()=>{}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})},
  SpreadsheetApp:{openById:id=>{assert.equal(id,'TEST-DESTINATION');return book;},newRichTextValue:()=>({setText(value){this.value=value;return this;},build(){return {literal:true,value:this.value};}}),flush:()=>{assert.equal(held,true);if(faults.flush){faults.flush=false;throw Error('flush failed');}}},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(held)return false;held=true;return true;},waitLock:()=>{assert.equal(held,false);held=true;},hasLock:()=>held,releaseLock:()=>held=false})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>[...crypto.createHash('sha256').update(value).digest()],formatDate:()=> '20261102'},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput:value=>({setMimeType:()=>value})},
  DriveApp:{getFolderById:()=>{throw Error('photo service not mocked; no live access');}}
 });
 for(const name of ['Core.gs','Code.gs'])vm.runInContext(fs.readFileSync(path.join(root,'backend',name),'utf8'),context,{filename:name});
 context.setupMergedWarehouse();
 const call=(command,token=props.get('WAREHOUSE_TOKEN'))=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({schema:4,...command,token})}}));
 return {call,tables,props,faults,context,book,isHeld:()=>held};
}
const part=(requestId='request-create-000001')=>({action:'createPart',requestId,code:'ITM-A',input:{name:'A'}});
test('authentication and schema checks fail closed',()=>{
 const s=service();assert.equal(s.call({action:'list'},'wrong').ok,false);assert.equal(s.call({action:'list',schema:3}).ok,false);assert.equal(s.tables.get('WarehouseJournal').rows.length,1);assert.equal(s.isHeld(),false);
});
test('create retry is replayed, mismatch including reason rejected, no token in journal',()=>{
 const s=service(),command=part();assert.equal(s.call(command).ok,true);assert.equal(s.call(command).replayed,true);
 assert.equal(s.tables.get('WarehouseJournal').rows.length,2);assert.equal(s.call({...command,reason:'different'}).ok,false);
 assert.ok(!s.tables.get('WarehouseJournal').rows[1][0].includes(s.props.get('WAREHOUSE_TOKEN')));assert.equal(s.isHeld(),false);
});
test('lost append acknowledgement: retry never duplicates commit',()=>{
 const s=service();s.faults.append='after';assert.equal(s.call(part()).outcomeUnknown,true);
 assert.equal(s.call({action:'list'}).state.parts.length,1);assert.equal(s.call(part()).replayed,true);assert.equal(s.tables.get('WarehouseJournal').rows.length,2);
});
test('append failed before persistence: exact retry executes once',()=>{
 const s=service();s.faults.append='before';assert.equal(s.call(part()).outcomeUnknown,true);assert.equal(s.call({action:'list'}).state.parts.length,0);
 assert.equal(s.call(part()).ok,true);assert.equal(s.call({action:'list'}).state.parts.length,1);
});
test('flush lost acknowledgement retains exactly one authoritative event',()=>{
 const s=service();s.faults.flush=true;assert.equal(s.call(part()).outcomeUnknown,true);assert.equal(s.call(part()).replayed,true);assert.equal(s.tables.get('WarehouseJournal').rows.length,2);
});
test('projection failure cannot undo or duplicate committed data; repair is repeatable',()=>{
 const s=service();s.faults.projection=true;const result=s.call(part());assert.equal(result.ok,true);assert.ok(result.warning);
 assert.equal(s.call({action:'list'}).state.parts.length,1);assert.equal(s.call(part()).replayed,true);
 s.context.rebuildMergedProjections();s.context.rebuildMergedProjections();assert.equal(s.tables.get('Parts').rows.length,2);assert.equal(s.tables.get('AuditLogs').rows.length,2);
});
test('literal cells use RichText, journal embeds text in JSON, no unescape heuristic',()=>{
 const s=service();for(const [i,name] of ['=1+1',"'=1+1",'  +123','-1','@x'].entries()){
  assert.equal(s.call({...part('literal-request-'+String(i).padStart(8,'0')),code:'ITM-'+i,input:{name,note:name}}).ok,true);
 }
 assert.deepEqual(s.call({action:'list'}).state.parts.map(p=>p.name),['=1+1',"'=1+1",'  +123','-1','@x']);
 assert.equal(s.tables.get('Parts').rows[1][2],'=1+1');assert.ok(s.tables.get('WarehouseJournal').rows.slice(1).every(r=>r[0].startsWith('{')));
});
test('auto code high water counter persists and concurrent duplicate manual code refused',()=>{
 const s=service();const first=s.call({...part(),code:''});assert.equal(first.result.id,'ITM-20261102-0001');
 const second=s.call({...part('request-create-000002'),code:''});assert.equal(second.result.id,'ITM-20261102-0002');
 assert.equal(s.props.get('MERGED_CODE.TEST-DESTINATION.ITM-20261102-'),'2');
 assert.equal(s.call({...part('request-create-000003'),code:first.result.id}).ok,false);
});
test('write-disabled deployment reads but cannot mutate',()=>{
 const s=service();s.props.set('MERGED_WRITE_ENABLED','false');assert.equal(s.call({action:'list'}).ok,true);assert.equal(s.call(part()).ok,false);assert.equal(s.tables.get('WarehouseJournal').rows.length,1);
});
test('health validates headers and failed validation does not append',()=>{
 const s=service();s.tables.get('WarehouseJournal').rows[0][0]='bad';assert.equal(s.call(part()).ok,false);assert.equal(s.tables.get('WarehouseJournal').rows.length,1);
});
test('setup refuses a populated legacy workbook without clearing it',()=>{
 const s=service();const legacy=s.book.insertSheet('工作表1');legacy.rows.push(['物品編號'],['REAL-DATA']);
 assert.throws(()=>s.context.setupMergedWarehouse(),/獨立空白/);assert.equal(legacy.rows[1][0],'REAL-DATA');
});
test('stock arithmetic retries remain idempotent after later operations',()=>{
 const s=service();s.call(part());const create=s.call({action:'createStock',requestId:'request-stock-000001',partId:'ITM-A',locationId:null,quantity:5,quantityState:'KNOWN'});
 const command={action:'adjustQuantity',requestId:'request-adjust-000001',stockId:create.result.id,expectedVersion:1,operation:'decrease',amount:1,reason:'領用'};
 assert.equal(s.call(command).result.quantity,4);
 assert.equal(s.call({...command,requestId:'request-adjust-000002',expectedVersion:2}).result.quantity,3);
 assert.equal(s.call(command).result.quantity,4);assert.equal(s.call({action:'list'}).state.stocks[0].quantity,3);
 assert.equal(s.call({...command,reason:'changed'}).ok,false);
});
