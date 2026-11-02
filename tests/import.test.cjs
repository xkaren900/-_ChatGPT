const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrationPlan}=require('../tools/migration.cjs'),{buildImport}=require('../tools/import-plan.cjs');
function plan(){return migrationPlan({sourceMetadata:{githubSpreadsheetId:'SYNTHETIC-TEST-SOURCE'},github:{items:[
 {id:'BOX-A',type:'box',name:'箱子',parent:'ROOM-A',photoId:'SYNTHETIC-PHOTO',createdAt:'2026-01-01T00:00:00Z'},
 {id:'ROOM-A',type:'room',name:'房間',parent:null,createdAt:'2026-01-01T00:00:00Z'},
 {id:'ITM-A',type:'item',name:'零件',parent:'BOX-A',quantity:5,createdAt:'2026-01-01T00:00:00Z'}],history:[
 {requestId:'original-request-000001',itemId:'ITM-A',operation:'set',amount:10,before:1,after:10,reason:'盤點',time:'2026-01-02T00:00:00Z'},
 {requestId:'original-request-000002',itemId:'ITM-A',operation:'decrease',amount:5,before:10,after:5,reason:'領用',time:'2026-01-03T00:00:00Z'}]}});}
test('import uses original baseline and history once, retaining IDs, photo and dates',()=>{
 const p=plan(),result=buildImport(p);assert.equal(result.counts.events,5);assert.equal(result.state.stocks[0].quantity,5);assert.equal(result.state.stocks[0].version,3);
 assert.deepEqual(result.events.slice(-2).map(x=>x.requestId),['original-request-000001','original-request-000002']);
 assert.equal(result.state.locations.find(x=>x.id==='BOX-A').photoId,'SYNTHETIC-PHOTO');assert.equal(result.state.parts[0].createdAt,'2026-01-01T00:00:00Z');
 assert.equal(result.state.stocks[0].updatedAt,'2026-01-03T00:00:00Z');assert.equal(result.rows.AuditLogs.length,6);
 assert.deepEqual(buildImport(p),result);
});
test('import rejects unresolved reviews and tampered archives',()=>{
 const p=plan();p.sourceArchive.github.items[2].quantity=999;assert.throws(()=>buildImport(p),/hash/);
 const unresolved=plan();unresolved.readyForReview=false;assert.throws(()=>buildImport(unresolved),/resolved/);
});
test('journal schema and projection headers match the live adapter contract',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const ctx=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/Code.gs'),'utf8')+'\nthis.headers=MERGED_HEADERS;',ctx);
 assert.deepEqual(buildImport(plan()).headers,JSON.parse(JSON.stringify(ctx.headers)));
});
