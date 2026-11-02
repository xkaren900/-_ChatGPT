const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.env.WAREHOUSE_PREVIEW_PORT||8765);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)||!types[path.extname(target)]){res.writeHead(403);return res.end();}
  res.writeHead(200,{'Content-Type':types[path.extname(target)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(target));
 }catch(_){res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:'+port+'/?preview=1'));
