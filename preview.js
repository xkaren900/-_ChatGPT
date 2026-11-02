// Explicit ?preview=1 only. No network, credentials, localStorage data or live inventory.
function createWarehousePreview() {
  let events = [], sequence = 0;
  const photos = new Map();
  function commit(command) {
    const fingerprint = JSON.stringify(command), previous = events.find(x => x.requestId === command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('相同請求識別碼不可使用不同內容');
      return {ok:true,schema:4,result:WarehouseCore.copy(previous.result),replayed:true};
    }
    const generatedCode = 'ITM-PREVIEW-' + String(++sequence).padStart(4,'0');
    const event = WarehouseCore.plan(WarehouseCore.replay(events),command,{time:new Date().toISOString(),fingerprint,generatedCode});
    if (command.photo) {
      photos.set(event.result.id,command.photo);
      event.changes[0].after.photoId = event.result.id; event.result.photoId = event.result.id;
    }
    events.push(event);
    return {ok:true,schema:4,result:WarehouseCore.copy(event.result)};
  }
  for (const command of [
    {action:'createLocation',code:'LOC-A-ROOM',input:{name:'工作室',type:'room',parentId:null}},
    {action:'createLocation',code:'LOC-B-CABINET',input:{name:'電料櫃',type:'cabinet',parentId:'LOC-A-ROOM'}},
    {action:'createLocation',code:'BOX-C-01',input:{name:'A抽屜',type:'box',parentId:'LOC-B-CABINET'}},
    {action:'createLocation',code:'BOX-C-02',input:{name:'B抽屜',type:'box',parentId:'LOC-B-CABINET'}},
    {action:'createLocation',code:'BOX-RESERVED',input:{name:'',type:'box',status:'RESERVED',parentId:'LOC-B-CABINET'}},
    {action:'createPart',code:'ITEM-SCREW-01',input:{name:'M3螺絲',manufacturer:'示範製造商',mpn:'M3-10',specification:'M3 × 10 mm',unit:'顆'},initialStock:{locationId:'BOX-C-01',quantity:100,quantityState:'KNOWN'}},
    {action:'createStock',partId:'ITEM-SCREW-01',locationId:'BOX-C-02',quantity:50,quantityState:'KNOWN'},
    {action:'createPart',code:'ITEM-RELAY-01',input:{name:'繼電器',manufacturer:'OMRON',mpn:'MY2N-GS',unit:'個'},initialStock:{locationId:'BOX-C-02',quantity:null,quantityState:'UNKNOWN'}}
  ]) commit({...command,requestId:'preview-seed-'+String(sequence).padStart(6,'0')});
  return {async request(command) {
    const state = WarehouseCore.replay(events);
    if (command.action === 'list') return {ok:true,schema:4,state};
    if (command.action === 'history') return {ok:true,schema:4,records:events.filter(x => x.changes.some(c => c.after.id === command.id)).slice(-50).reverse()};
    if (command.action === 'photo') return {ok:true,schema:4,photo:photos.get(command.id) || ''};
    if (command.action === 'requestStatus') {
      const event = events.find(x => x.requestId === command.requestId);
      return {ok:true,schema:4,committed:!!event,result:event?.result || null};
    }
    return commit(command);
  }};
}
