const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {root}=require('./helpers.cjs');
test('explicit preview has multi-location stock, reserved location and unknown quantity',async()=>{
 const ctx=vm.createContext({});for(const file of ['domain.js','preview.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 const preview=ctx.createWarehousePreview(),result=await preview.request({action:'list'});
 assert.equal(result.state.parts.length,2);assert.equal(result.state.locations.length,5);assert.equal(result.state.stocks.length,3);
 assert.equal(ctx.WarehouseCore.summary(result.state,'ITEM-SCREW-01').known,150);assert.equal(ctx.WarehouseCore.summary(result.state,'ITEM-RELAY-01').unknown,1);
 const stock=result.state.stocks[0],command={action:'adjustQuantity',requestId:'preview-user-000001',stockId:stock.id,expectedVersion:1,operation:'decrease',amount:1};
 await preview.request(command);assert.equal((await preview.request(command)).replayed,true);assert.equal((await preview.request({action:'list'})).state.stocks[0].quantity,99);
});
