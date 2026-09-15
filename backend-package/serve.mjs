// Reference content API. No database, authentication or code execution.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const routes=new Map(await Promise.all(manifest.files.map(async entry=>[entry.endpoint,await readFile(path.join(root,entry.file))])));
export function createContentServer(){
  return http.createServer((req,res)=>{
    const origin=req.headers.origin;
    if(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Idempotency-Key, X-CSRF-Token');
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    const send=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body))};
    const error=(status,code,message)=>send(status,{error:{code,message,details:null}});
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && routes.has(url.pathname)){res.writeHead(200);res.end(routes.get(url.pathname));return}
    if(req.method==='GET' && url.pathname==='/api/v1/submissions'){
      if(!routes.has('/api/v1/lessons/'+url.searchParams.get('lessonId')))return error(404,'NOT_FOUND','Урок не найден.');
      return send(200,{data:[],meta:{schemaVersion:'1.0'}});
    }
    if(req.method==='POST' && ['/api/v1/submissions','/api/v1/task-submissions'].includes(url.pathname))return error(503,'RUNNER_NOT_CONFIGURED','Проект ещё в разработке, сервер проверки решений ещё не подключён');
    error(404,'NOT_FOUND','Маршрут или материал не найден.');
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4180),server=createContentServer();
  server.on('error',error=>{console.error(error.message);process.exitCode=1});
  server.listen(port,'127.0.0.1',()=>console.log(`LogicKernel content API: http://127.0.0.1:${port}/api/v1/courses`));
}
