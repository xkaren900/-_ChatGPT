const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {root}=require('./helpers.cjs');
const snapshot={schema:4,parts:[],locations:[],stocks:[]},endpoint='https://example.invalid/test-only';
function client(handler,storage=new Map()){
 const elements=new Map(),local=new Map([['warehouse-token:'+endpoint,'test-only-token']]),callbacks=[];let id=0;
 const sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context=vm.createContext({window:{WAREHOUSE_CONFIG:{endpoint}},location:{search:''},URLSearchParams,AbortController,setTimeout,clearTimeout,TypeError,console,
  crypto:{randomUUID:()=> 'request-browser-'+String(++id).padStart(8,'0')},sessionStorage,
  localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  document:{querySelector:s=>{if(!elements.has(s))elements.set(s,{});return elements.get(s);},addEventListener:(_,fn)=>callbacks.push(fn)},
  fetch:async(_,options)=>({ok:true,json:async()=>handler(JSON.parse(options.body))})
 });
 vm.runInContext(fs.readFileSync(path.join(root,'cloud.js'),'utf8')+'\nthis.clientAPI=warehouseCloud;',context);
 callbacks.forEach(fn=>fn());
 return {api:context.clientAPI,storage,elements,context};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('uncertain mutation persists exact payload and blocks unrelated mutations',async()=>{
 let fail=true;const writes=[];
 const c=client(command=>{if(command.action==='list')return {ok:true,schema:4,state:snapshot};writes.push(command);if(fail)throw Error('lost reply');return {ok:true,schema:4,result:{id:'ITM-A'},replayed:true};});
 await settled();await assert.rejects(c.api.mutate({action:'createPart',input:{name:'A'}}),/尚未確認/);
 assert.equal(c.storage.size,1);await assert.rejects(c.api.mutate({action:'createPart',input:{name:'B'}}),/上次操作/);
 fail=false;await c.api.resolvePending();assert.deepEqual(writes[0],writes[1]);assert.equal(c.storage.size,0);
});
test('pending request survives reload and original RequestID is reused',async()=>{
 const storage=new Map();let first;
 const c=client(command=>{if(command.action==='list')return {ok:true,schema:4,state:snapshot};first=command;throw Error('timeout');},storage);
 await settled();await assert.rejects(c.api.mutate({action:'adjustQuantity',stockId:'a',expectedVersion:2,operation:'decrease',amount:1}));
 let retried;const reload=client(command=>{if(command.action==='list')return {ok:true,schema:4,state:snapshot};retried=command;return {ok:true,schema:4,result:{}};},storage);
 await settled();await reload.api.resolvePending();assert.deepEqual(retried,first);
});
test('acknowledged mutation followed by refresh failure does not create another write',async()=>{
 let writes=0,reads=0;
 const c=client(command=>{if(command.action==='list'){if(++reads>1)throw Error('read offline');return {ok:true,schema:4,state:snapshot};}writes++;return {ok:true,schema:4,result:{id:'A'}};});
 await settled();const result=await c.api.mutate({action:'createPart',input:{name:'A'}});assert.equal(result.ok,true);assert.equal(writes,1);assert.equal(c.storage.size,0);assert.match(c.elements.get('#cloudStatus').textContent,/操作已提交/);
});
test('definite validation error clears pending; unauthorized keeps it for reconciliation',async()=>{
 let error='資料版本衝突';const c=client(command=>command.action==='list'?{ok:true,schema:4,state:snapshot}:{ok:false,schema:4,error});
 await settled();await assert.rejects(c.api.mutate({action:'updatePart'}),/版本衝突/);assert.equal(c.storage.size,0);
 error='未授權';await assert.rejects(c.api.mutate({action:'createPart'}),/未授權/);assert.equal(c.storage.size,1);
});
test('literal and multi-location UI helpers display partial totals and changed ancestry',()=>{
 const elements=new Map(),get=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',open:false,close(){this.open=false;},classList:{add(){},remove(){},toggle(){}},addEventListener(){}});return elements.get(s);};
 const context=vm.createContext({console,window:{},document:{querySelector:get,querySelectorAll:()=>[]},warehouseCloud:{},setTimeout,clearTimeout,scrollTo(){},navigator:{},Event});
 vm.runInContext(fs.readFileSync(path.join(root,'domain.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
 context.warehouseCloud.onState({schema:4,parts:[{id:'ITM-A',name:'=1+1',unit:'顆',version:1}],locations:[{id:'LOC-A',name:'房間',type:'room',parentId:null,status:'ACTIVE'},{id:'BOX-A',name:'抽屜',type:'box',parentId:'LOC-A',status:'ACTIVE'}],stocks:[{id:'a',partId:'ITM-A',locationId:'BOX-A',quantity:0,quantityState:'KNOWN'},{id:'b',partId:'ITM-A',locationId:null,quantity:null,quantityState:'UNKNOWN'}]});
 assert.equal(context.window.WarehouseUI.locationPath('BOX-A'),'房間 › 抽屜');assert.equal(context.window.WarehouseUI.totalText({id:'ITM-A',unit:'顆'}),'已知合計 0 顆，另有 1 處數量未知');assert.match(context.row({id:'ITM-A',name:'=1+1',type:'item',unit:'顆'}),/=1\+1/);
 assert.doesNotMatch(elements.get('#homeView').innerHTML,/最近項目|Warehouse overview/);
});
