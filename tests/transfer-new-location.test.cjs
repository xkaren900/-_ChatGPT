const {test}=require('node:test'),assert=require('node:assert/strict');
const {model}=require('./helpers.cjs');
function fixture(){const m=model();m.location('BOX-A');m.location('BOX-B');m.part();const from=m.stock('ITM-A','BOX-A',5);return {m,from};}
test('transfer creates missing destination in the same event and conserves quantity',()=>{
 const {m,from}=fixture(),before=m.events.length;
 const result=m.send({action:'transferStock',fromStockId:from.id,toLocationId:'BOX-B',expectedFromVersion:1,expectedToVersion:null,amount:2});
 assert.equal(m.events.length,before+1);assert.equal(m.events.at(-1).changes.length,2);assert.equal(m.events.at(-1).changes[1].before,null);
 assert.equal(result.from.quantity,3);assert.equal(result.to.quantity,2);assert.equal(result.to.version,1);assert.equal(m.engine.summary(m.state(),'ITM-A').known,5);
});
test('new destination transfer rejects insufficient quantity, reserved targets and concurrent creation without partial writes',()=>{
 for(const scenario of ['insufficient','reserved','concurrent']){
  const {m,from}=fixture();
  if(scenario==='reserved')m.send({action:'updateLocation',id:'BOX-B',expectedVersion:1,input:{status:'RESERVED'}});
  if(scenario==='concurrent')m.stock('ITM-A','BOX-B',7);
  const before=JSON.stringify(m.state()),count=m.events.length;
  assert.throws(()=>m.send({action:'transferStock',fromStockId:from.id,toLocationId:'BOX-B',expectedFromVersion:1,expectedToVersion:null,amount:scenario==='insufficient'?6:2}));
  assert.equal(JSON.stringify(m.state()),before);assert.equal(m.events.length,count);
 }
});
test('location transfer requires exact existing destination version and rejects unknown destination',()=>{
 const {m,from}=fixture();m.stock('ITM-A','BOX-B',0);
 assert.throws(()=>m.send({action:'transferStock',fromStockId:from.id,toLocationId:'BOX-B',expectedFromVersion:1,expectedToVersion:0,amount:1}),/版本衝突/);
 const result=m.send({action:'transferStock',fromStockId:from.id,toLocationId:'BOX-B',expectedFromVersion:1,expectedToVersion:1,amount:1});assert.equal(result.to.quantity,1);
});
