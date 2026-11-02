const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrationPlan}=require('../tools/migration.cjs');
test('migration preserves QR, unassigned location, latest log quantity, original archive',()=>{
 const input={github:{items:[{id:'BOX-A',type:'box',name:'A',parent:null},{id:'ITM-A',type:'item',name:'螺絲',parent:null,quantity:10}],history:[{requestId:'legacy-1',itemId:'ITM-A',before:10,after:9}]}};
 const before=JSON.stringify(input),result=migrationPlan(input);assert.equal(result.mode,'DRY_RUN_ONLY');assert.equal(result.proposed.parts[0].id,'ITM-A');assert.equal(result.proposed.stocks[0].locationId,null);assert.equal(result.proposed.stocks[0].quantity,9);assert.deepEqual(result.sourceArchive,input);assert.equal(JSON.stringify(input),before);
});
test('same names stay separate; collisions and missing parents block review',()=>{
 const result=migrationPlan({github:{items:[{id:'ITM-A',type:'item',name:'螺絲',parent:'MISSING',quantity:0},{id:'ITM-B',type:'item',name:'螺絲',parent:null,quantity:0}]},private:{parts:[{PartID:'itm-a',PartName:'另一物品'}]}});
 assert.equal(result.counts.parts,2);assert.ok(result.issues.some(x=>x.code==='POSSIBLE_DUPLICATE'));assert.ok(result.issues.some(x=>x.code==='CODE_COLLISION'));assert.equal(result.readyForReview,false);
});
test('unknown never becomes zero; private parts without stock do not invent inventory',()=>{
 const result=migrationPlan({github:{items:[{id:'ITM-A',type:'item',name:'A',quantity:null,parent:null},{id:'ITM-B',type:'item',name:'B',quantity:0,parent:null}]},private:{parts:[{PartID:'P-000001',PartName:'C'}]}});
 assert.equal(result.counts.parts,3);assert.equal(result.counts.stocks,2);assert.equal(result.proposed.stocks[0].quantityState,'UNKNOWN');assert.equal(result.proposed.stocks[1].quantityState,'KNOWN');
});
test('test data, missing private location types and historic gaps require review',()=>{
 const result=migrationPlan({github:{items:[{id:'ITM-A',name:'TEST-CODEX',type:'item',quantity:2}],history:[{requestId:'a',itemId:'ITM-A',before:3,after:2},{requestId:'b',itemId:'ITM-A',before:1,after:0}]},private:{locations:[{LocationID:'L-000001',LocationName:'櫃子'}]}});
 for(const code of ['TEST_DATA_REVIEW','LOCATION_TYPE_REQUIRED','HISTORY_GAP'])assert.ok(result.issues.some(x=>x.code===code));assert.equal(result.readyForReview,false);
});
test('migration preserves location dates and rejects unnormalized serial dates',()=>{
 const createdAt='2026-01-01T16:40:30.074Z',updatedAt='2026-01-02T00:00:00.000Z';
 const result=migrationPlan({github:{items:[{id:'BOX-A',type:'box',name:'箱子',createdAt,updatedAt}]}});
 assert.equal(result.proposed.locations[0].createdAt,createdAt);assert.equal(result.proposed.locations[0].updatedAt,updatedAt);
 assert.equal(result.readyForReview,true);
 assert.ok(migrationPlan({github:{items:[{id:'BOX-A',type:'box',name:'箱子',createdAt:46000}]}}).issues.some(x=>x.code==='DATE_NORMALIZATION_REQUIRED'));
});
test('history arithmetic and orphan references block; explicit test retention stays visible',()=>{
 const input={github:{items:[{id:'ITM-A',type:'item',name:'測試物品',quantity:5}],history:[{requestId:'legacy1',itemId:'ITM-A',operation:'decrease',amount:5,before:10,after:5}]},decisions:{retainTestIds:['ITM-A']}};
 const result=migrationPlan(input);assert.equal(result.readyForReview,true);assert.equal(result.issues.find(x=>x.code==='TEST_DATA_REVIEW').blocking,false);
 input.github.history[0].after=6;assert.ok(migrationPlan(input).issues.some(x=>x.code==='HISTORY_ARITHMETIC'));
 input.github.history[0].itemId='MISSING';assert.ok(migrationPlan(input).issues.some(x=>x.code==='ORPHAN_HISTORY'));
});
