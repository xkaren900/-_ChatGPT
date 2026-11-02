const {test}=require('node:test'),assert=require('node:assert/strict');const {model}=require('./helpers.cjs');
test('part-only creation has no stock; later stock can be added without inventing zero',()=>{
 const m=model();m.part();assert.equal(m.state().stocks.length,0);m.location();m.stock('ITM-A','BOX-A',3);assert.equal(m.state().stocks[0].quantity,3);
});
test('unassigned stock can relocate or merge atomically without losing quantity',()=>{
 const m=model();m.part();m.location();const stock=m.stock('ITM-A',null,5);
 const result=m.send({action:'relocateStock',stockId:stock.id,expectedVersion:1,toLocationId:'BOX-A',expectedToVersion:null});
 assert.equal(result.from.status,'ARCHIVED');assert.equal(result.from.quantity,0);assert.equal(result.to.quantity,5);assert.equal(m.engine.summary(m.state(),'ITM-A').known,5);assert.equal(m.events.at(-1).changes.length,2);
 m.send({action:'restoreStock',stockId:stock.id,expectedVersion:2});assert.equal(m.engine.summary(m.state(),'ITM-A').known,5);
 assert.throws(()=>m.send({action:'relocateStock',stockId:stock.id,expectedVersion:1,toLocationId:'BOX-A',expectedToVersion:1}),/版本衝突/);
});
test('archive unknown or zero stock is reversible; positive inventory cannot be discarded',()=>{
 for(const [quantity,state] of [[null,'UNKNOWN'],[0,'KNOWN']]){
  const m=model();m.part();const s=m.stock('ITM-A',null,quantity,state);m.send({action:'archiveStock',stockId:s.id,expectedVersion:1});assert.equal(m.engine.summary(m.state(),'ITM-A').locations,0);
  assert.throws(()=>m.send({action:'adjustQuantity',stockId:s.id,expectedVersion:2,operation:'set',amount:2}),/已移除/);
  m.send({action:'restoreStock',stockId:s.id,expectedVersion:2});assert.equal(m.state().stocks[0].quantity,quantity);assert.equal(m.engine.summary(m.state(),'ITM-A').locations,1);
 }
 const m=model();m.part();const s=m.stock('ITM-A',null,1);const count=m.events.length;assert.throws(()=>m.send({action:'archiveStock',stockId:s.id,expectedVersion:1}),/仍有庫存/);assert.equal(m.events.length,count);
});
test('relocation to existing stock merges known quantities and refuses unknown or stale targets',()=>{
 const m=model();m.part();m.location();const a=m.stock('ITM-A',null,5),b=m.stock('ITM-A','BOX-A',2);
 assert.throws(()=>m.send({action:'relocateStock',stockId:a.id,expectedVersion:1,toLocationId:'BOX-A',expectedToVersion:null}),/版本衝突/);
 const result=m.send({action:'relocateStock',stockId:a.id,expectedVersion:1,toLocationId:'BOX-A',expectedToVersion:1});assert.equal(result.to.quantity,7);assert.equal(m.engine.summary(m.state(),'ITM-A').known,7);
});
