const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function core(){const context=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'backend/Core.gs'),'utf8'),context);return context.WarehouseCore;}
const plain=x=>JSON.parse(JSON.stringify(x));
function model(){
  const engine=core(),events=[];let index=0;
  function send(command){
    command={requestId:'test-request-'+String(++index).padStart(8,'0'),...command};
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const previous=events.find(e=>e.requestId===command.requestId);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('相同請求識別碼不可使用不同內容');return plain(previous.result);}
    const event=engine.plan(engine.replay(events),command,{time:'2026-11-02T00:00:00.000Z',fingerprint,generatedCode:'ITM-AUTO-'+index});
    events.push(plain(event));return plain(event.result);
  }
  return {engine,events,send,state:()=>plain(engine.replay(events)),location:(id='BOX-A',parentId=null,status='ACTIVE')=>send({action:'createLocation',code:id,input:{name:status==='RESERVED'?'':id,type:'box',parentId,status}}),part:(id='ITM-A',extra={})=>send({action:'createPart',code:id,input:{name:id,...extra}}),stock:(partId,locationId,quantity=0,quantityState='KNOWN')=>send({action:'createStock',partId,locationId,quantity,quantityState})};
}
module.exports={root,core,model,plain};
