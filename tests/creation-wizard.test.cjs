const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {root,core}=require('./helpers.cjs');
function commands(){const elements=new Map(),get=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',open:false,close(){},classList:{add(){},remove(){},toggle(){}},addEventListener(){}});return elements.get(s);};
 const context=vm.createContext({window:{},document:{querySelector:get,querySelectorAll:()=>[]},warehouseCloud:{},setTimeout,clearTimeout,scrollTo(){},navigator:{},Event,console});
 vm.runInContext(fs.readFileSync(path.join(root,'domain.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);return (mode,values,photo)=>JSON.parse(JSON.stringify(context.buildAddCommand(mode,values,photo)));
}
test('wizard blank quantity creates only a part and defaults unit, even when a location was selected',()=>{
 const build=commands(),command=build('item',{name:'先建物品',quantity:'',unit:'',locationId:'BOX-A'});assert.equal(command.input.unit,'個');assert.ok(!('initialStock'in command));
 const engine=core(),event=engine.plan(engine.empty(),{...command,requestId:'wizard-part-only'},{generatedCode:'ITM-WIZARD',time:'2026-11-03T00:00:00Z',fingerprint:'test'});assert.equal(event.changes.length,1);assert.equal(event.changes[0].table,'parts');
});
test('wizard zero is known inventory, custom unit and selected location survive',()=>{
 const command=commands()('item',{name:'螺絲',quantity:'0',unit:'顆',locationId:'BOX-A',mpn:'=literal',code:'ITM-QR-123'});assert.deepEqual(command.initialStock,{locationId:'BOX-A',quantityState:'KNOWN',quantity:0});assert.equal(command.input.unit,'顆');assert.equal(command.input.mpn,'=literal');assert.equal(command.code,'ITM-QR-123');
});
test('wizard enforces name, QR and quantity rules before submission',()=>{
 const build=commands();assert.throws(()=>build('item',{name:' ',quantity:''}),/名稱/);assert.throws(()=>build('item',{name:'A',code:'https://invalid',quantity:''}),/QR/);
 for(const quantity of ['-1','NaN','1000000000001','0.0000001'])assert.throws(()=>build('item',{name:'A',quantity}));
});
test('location wizard preserves hierarchy, type, reserved unnamed state and optional photo',()=>{
 const build=commands(),command=build('location',{name:'',type:'box',status:'RESERVED',locationId:'CAB-A',note:'留待命名'},'data:image/jpeg;base64,AAAA');
 assert.deepEqual(command.input,{name:'',type:'box',status:'RESERVED',parentId:'CAB-A',note:'留待命名'});assert.equal(command.action,'createLocation');assert.ok(!('initialStock'in command));assert.ok(command.photo);
 assert.throws(()=>build('location',{name:'',status:'ACTIVE',type:'box'}),/名稱/);
});
