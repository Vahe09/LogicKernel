import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import {createContentServer} from '../backend-package/serve.mjs';

const root=new URL('../',import.meta.url);
const read=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const server=createContentServer();
const checks=[];
function check(condition,label){assert.ok(condition,label);checks.push(label)}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const script=await readFile(new URL('api.js',root),'utf8');
function adapter(mode){
  const storage=new Map();
  const context=vm.createContext({window:{LK_CONFIG:{mode,baseUrl:base+'/api/v1',requestTimeoutMs:2000,mockLatencyMs:0}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    document:{querySelector:()=>null,createElement:()=>{throw new Error('HTTP must not load local scripts')}},
    fetch,AbortController,DOMException,TextEncoder,structuredClone,crypto,setTimeout,clearTimeout,URLSearchParams});
  return {context,init:()=>{vm.runInContext(script,context);return context.window.LKApi}};
}
try{
  const manifest=await read('backend-package/manifest.json');
  const openapi=await read('backend-package/openapi.json');
  async function resolveRefs(value){
    if(!value||typeof value!=='object')return;
    if(value.$ref){
      const [file,fragment]=value.$ref.split('#');
      const document=await read('backend-package/'+file.replace(/^\.\//,''));
      const target=fragment?fragment.slice(1).split('/').reduce((v,k)=>v?.[k],document):document;
      check(!!target,'OpenAPI reference '+value.$ref);
    }
    for(const child of Object.values(value))await resolveRefs(child);
  }
  check(openapi.openapi==='3.1.0'&&Object.keys(openapi.paths).length===7,'OpenAPI operations');
  await resolveRefs(openapi.paths);
  const httpAdapter=adapter('http'),api=httpAdapter.init();
  for(const entry of manifest.files){
    const expected=await read('backend-package/'+entry.file);
    const response=await fetch(base+entry.endpoint);
    check(response.status===200&&response.headers.get('content-type').includes('application/json'),'HTTP '+entry.endpoint);
    assert.deepEqual(await response.json(),expected);
    const route=entry.endpoint.slice('/api/v1'.length);
    const actual=route==='/courses'?await api.listCourses():route.startsWith('/courses/')?await api.getCourse(route.slice(9)):await api.getLesson(route.slice(9));
    assert.deepEqual(actual,expected);
    check(true,'Adapter/export equality '+route);
  }
  check(!httpAdapter.context.window.LK_MOCK_BUNDLE,'HTTP adapter never loads mock content');
  const history=await api.listSubmissions('python-01');check(history.data.length===0,'Empty real history');
  await assert.rejects(api.getLesson('missing-lesson'),e=>e.code==='NOT_FOUND'&&e.status===404);check(true,'Missing lesson JSON error');
  const request=await read('backend-package/examples/submission-request.json');
  await assert.rejects(api.submit(request,{idempotencyKey:'test-http'}),e=>e.code==='RUNNER_NOT_CONFIGURED'&&e.status===503);check(true,'No fabricated result without runner');
  const cors=await fetch(base+'/api/v1/courses',{headers:{Origin:'http://localhost:4173'}});check(cors.headers.get('access-control-allow-origin')==='http://localhost:4173','Local preview CORS');
  const preflight=await fetch(base+'/api/v1/submissions',{method:'OPTIONS',headers:{Origin:'http://localhost:4173','Access-Control-Request-Headers':'content-type,idempotency-key'}});check(preflight.status===204,'Submission preflight');
  const denied=await fetch(base+'/api/v1/courses',{headers:{Origin:'https://unrelated.example'}});check(!denied.headers.get('access-control-allow-origin'),'Preview CORS excludes unrelated origin');
  const mockAdapter=adapter('mock');vm.runInContext(await readFile(new URL('content/mock-bundle.js',root),'utf8'),mockAdapter.context);const mock=mockAdapter.init();
  await assert.rejects(mock.submit(request,{idempotencyKey:'test'}),e=>e.code==='PROJECT_IN_DEVELOPMENT');check(true,'Course submission disabled in development');
  const taskRequest=await read('backend-package/examples/task-submission-request.json');
  await assert.rejects(mock.submitTask(taskRequest,{idempotencyKey:'test-task'}),e=>e.code==='PROJECT_IN_DEVELOPMENT');check(true,'Task submission disabled in development');
  check((await mock.listSubmissions('python-01')).data.length===0,'No fake history');
  await assert.rejects(api.submitTask(taskRequest,{idempotencyKey:'test-http-task'}),e=>e.code==='RUNNER_NOT_CONFIGURED');check(true,'Task preview has no runner');
  for(const file of ['app.js','api.js','lesson-view.js','task-submit.js']){const source=await readFile(new URL(file,root),'utf8');check(!/new\s+(?:Worker|Function)\s*\(|\beval\s*\(|\.srcdoc\s*=/.test(source),'No browser code executor '+file)}
  const tasks=await read('backend-package/task-import.json');check(tasks.tasks.length===6&&tasks.tasks.every(t=>!('solution' in t)&&!('tests' in t)),'Only public task metadata shipped');
  const cancel=new AbortController();cancel.abort();await assert.rejects(mock.getLesson('python-01',{signal:cancel.signal}),e=>e.name==='AbortError');check(true,'Aborted request');
  await mkdir(new URL('verification/',root),{recursive:true});
  const report={passed:checks.length,errors:[],checks};await writeFile(new URL('verification/contract-results.json',root),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,errors:[]},null,2));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
