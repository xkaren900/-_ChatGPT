const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
for(const file of ['app.js','cloud.js','config.js','domain.js','photo.js','preview.js','quantity.js','backend/Core.gs','backend/Code.gs']){
 new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
}
if(fs.readFileSync(path.join(root,'domain.js'),'utf8')!==fs.readFileSync(path.join(root,'backend/Core.gs'),'utf8'))throw Error('Domain copies differ');
const config=fs.readFileSync(path.join(root,'config.js'),'utf8');
if(/WAREHOUSE_TOKEN\s*[:=]\s*['"][^'"]+/.test(config))throw Error('Credentials must not be committed');
const sandbox={window:{}};vm.runInNewContext(config,sandbox);
const endpoint=sandbox.window.WAREHOUSE_CONFIG.endpoint;
if(endpoint&&!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))throw Error('Invalid Apps Script endpoint');
console.log('9 browser/backend scripts parsed; domain copies match; endpoint valid; no embedded shared key.');
