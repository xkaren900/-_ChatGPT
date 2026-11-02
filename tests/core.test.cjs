const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {model,core,root}=require('./helpers.cjs');
test('browser and Apps Script use identical domain logic',()=>assert.equal(fs.readFileSync(path.join(root,'domain.js'),'utf8'),fs.readFileSync(path.join(root,'backend/Core.gs'),'utf8')));
test('one part, two locations, independent quantities and sum',()=>{
 const m=model();m.location('BOX-A');m.location('BOX-B');m.part();m.stock('ITM-A','BOX-A',100);m.stock('ITM-A','BOX-B',50);
 assert.equal(m.state().parts.length,1);assert.equal(m.state().stocks.length,2);assert.deepEqual(JSON.parse(JSON.stringify(m.engine.summary(m.state(),'ITM-A'))),{known:150,unknown:0,locations:2});
});
test('unknown stays null, zero stays known, no false complete total',()=>{
 const m=model();m.location();m.part();m.stock('ITM-A','BOX-A',0);m.stock('ITM-A',null,null,'UNKNOWN');
 assert.equal(m.state().stocks[0].quantity,0);assert.equal(m.state().stocks[1].quantity,null);assert.equal(m.engine.summary(m.state(),'ITM-A').unknown,1);
});
test('unknown quantity rejects arithmetic until count, known can become unknown',()=>{
 const m=model();m.part();const s=m.stock('ITM-A',null,null,'UNKNOWN');
 assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'increase',amount:1}),/先盤點/);
 const counted=m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'set',amount:0});assert.equal(counted.quantity,0);
 const unknown=m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:2,operation:'unknown',amount:null});assert.equal(unknown.quantity,null);assert.equal(unknown.version,3);
});
test('stock key unique, unassigned preserved, missing parents refused',()=>{
 const m=model();m.part();m.stock('ITM-A',null);assert.throws(()=>m.stock('ITM-A',null),/已有庫存/);assert.throws(()=>m.stock('ITM-A','MISSING'),/不存在/);
});
test('reserved can be unnamed but cannot contain new locations or stock',()=>{
 const m=model();const reserved=m.location('BOX-R',null,'RESERVED');assert.equal(reserved.name,'');m.part();
 assert.throws(()=>m.location('BOX-C','BOX-R'),/尚未啟用/);assert.throws(()=>m.stock('ITM-A','BOX-R'),/尚未啟用/);
 assert.throws(()=>m.send({action:'createLocation',code:'BOX-X',input:{name:' ',type:'box',parentId:null}}),/不可空白/);
});
test('cannot reserve a location with children or stock',()=>{
 const m=model();m.location();m.location('BOX-B','BOX-A');assert.throws(()=>m.send({action:'updateLocation',id:'BOX-A',expectedVersion:1,input:{status:'RESERVED'}}),/仍有/);
});
test('moving a container changes only ancestry, rejects cycles and stale ABA',()=>{
 const m=model();m.location('ROOT');m.location('BOX-A','ROOT');m.location('BOX-B','BOX-A');m.part();m.stock('ITM-A','BOX-B',8);
 assert.throws(()=>m.send({action:'moveLocation',id:'BOX-A',expectedVersion:1,parentId:'BOX-B'}),/下層/);
 m.send({action:'moveLocation',id:'BOX-A',expectedVersion:1,parentId:null});m.send({action:'moveLocation',id:'BOX-A',expectedVersion:2,parentId:'ROOT'});
 assert.throws(()=>m.send({action:'moveLocation',id:'BOX-A',expectedVersion:1,parentId:null}),/版本衝突/);assert.equal(m.state().stocks[0].quantity,8);assert.equal(m.state().locations.find(x=>x.id==='BOX-B').parentId,'BOX-A');
});
test('part edit version does not change stock version; stale part refused',()=>{
 const m=model();m.part();m.stock('ITM-A',null,4);m.send({action:'updatePart',id:'ITM-A',expectedVersion:1,input:{mpn:'OMRON-MY2N',unit:'個'}});
 assert.equal(m.state().parts[0].version,2);assert.equal(m.state().stocks[0].version,1);assert.throws(()=>m.send({action:'updatePart',id:'ITM-A',expectedVersion:1,input:{name:'B'}}),/版本衝突/);
});
test('stale quantity update rejected without changing prior successful value',()=>{
 const m=model();m.part();const s=m.stock('ITM-A',null,5);m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'decrease',amount:1});
 assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'decrease',amount:2}),/版本衝突/);assert.equal(m.state().stocks[0].quantity,4);
});
test('negative, infinite, coercible strings, excessive precision and no-op rejected',()=>{
 const m=model();m.part();const s=m.stock('ITM-A',null,3);
 for(const amount of [-1,Infinity,NaN,'2',null,1.0000001,1e13])assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'set',amount}));
 assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'decrease',amount:4}));assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:1,operation:'set',amount:3}),/未改變/);assert.equal(m.state().stocks[0].quantity,3);
});
test('transfer commits two stock changes in one event and preserves total',()=>{
 const m=model();m.location();m.part();const a=m.stock('ITM-A','BOX-A',5),b=m.stock('ITM-A',null,2);
 const command={action:'transferStock',fromStockId:a.id,toStockId:b.id,expectedFromVersion:1,expectedToVersion:1,amount:2,reason:'領出搬箱'};
 const result=m.send(command);assert.equal(result.from.quantity,3);assert.equal(result.to.quantity,4);assert.equal(m.events.at(-1).changes.length,2);assert.equal(m.engine.summary(m.state(),'ITM-A').known,7);
 assert.throws(()=>m.send(command),/版本衝突/);
});
test('failed transfer produces no half-transfer event',()=>{
 const m=model();m.location();m.part();const a=m.stock('ITM-A','BOX-A',2),b=m.stock('ITM-A',null,0);const count=m.events.length;
 assert.throws(()=>m.send({action:'transferStock',fromStockId:a.id,toStockId:b.id,expectedFromVersion:1,expectedToVersion:1,amount:3}));assert.equal(m.events.length,count);assert.deepEqual(m.state().stocks.map(x=>x.quantity),[2,0]);
});
test('all supported literals preserve exact characters including leading apostrophes',()=>{
 for(const name of ['=1+1','+123','-1','@A',"'=1+1","''abc",'  =SUM(1,2)','<script>測試</script>']){
  const m=model();m.part('ITM-LITERAL',{name,note:name,mpn:name});const p=m.state().parts[0];assert.equal(p.name,name);assert.equal(p.note,name);assert.equal(p.mpn,name);
 }
});
test('case insensitive QR uniqueness across locations and parts',()=>{
 const m=model();m.location('BOX-A');assert.throws(()=>m.part('box-a'),/已使用/);assert.throws(()=>m.part('A" onclick="x'),/編號/);
});
test('replay is deterministic, detects duplicate request and broken sequence',()=>{
 const m=model();m.part();assert.deepEqual(JSON.parse(JSON.stringify(core().replay(m.events))),m.state());
 assert.throws(()=>m.engine.replay(m.events.concat(m.events[0])),/重複/);
 const broken=JSON.parse(JSON.stringify(m.events));broken[0].changes[0].before={id:'bad'};assert.throws(()=>m.engine.replay(broken),/不一致/);
});
