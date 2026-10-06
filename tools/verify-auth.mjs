import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runId=crypto.randomUUID();
const dataDir=path.join(root,'.local-backend','auth-test-'+runId);
const profileDir=path.join(root,'verification','browser-profile','auth-'+runId);
const checks=[],errors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value,label){assert.ok(value,label);checks.push(label)}
async function freePort(){const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port}
const port=await freePort(),debugPort=await freePort(),base='http://127.0.0.1:'+port;
let api,browser,socket,apiOutput='';

async function startApi(){
  api=spawn(path.join(root,'.venv','Scripts','python.exe'),['-m','uvicorn',(process.env.LK_AUTH_TEST_APP||'python_backend')+':app','--app-dir',process.env.LK_AUTH_TEST_APP_DIR||'backend-package/examples','--host','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,LK_DATA_DIR:dataDir,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  api.stdout.on('data',chunk=>{apiOutput+=chunk});api.stderr.on('data',chunk=>{apiOutput+=chunk});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/v1/courses')).ok)return}catch{}await pause(100)}
  throw new Error('Python API did not start: '+apiOutput.slice(-3000));
}
async function stopApi(){if(!api||api.exitCode!==null)return;const stopped=new Promise(resolve=>api.once('exit',resolve));api.kill();await stopped}

class Client{
  cookie='';csrf='';
  async request(method,url,body,headers={}){
    const res=await fetch(base+'/api/v1'+url,{method,headers:{Accept:'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&this.csrf?{'X-CSRF-Token':this.csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const cookies=res.headers.getSetCookie();if(cookies.length)this.cookie=cookies[0].split(';')[0];
    const json=await res.json();if(json.data?.csrfToken)this.csrf=json.data.csrfToken;
    return {status:res.status,json,res};
  }
  session(){return this.request('GET','/auth/session')}
}

try{
  await startApi();
  const alice=new Client(),bob=new Client(),guest=new Client();
  const guestSession=await guest.session();check(guestSession.json.data.user===null&&guest.csrf,'Guest session includes CSRF');
  check(/httponly/i.test(guestSession.res.headers.get('set-cookie')),'Session cookie is HttpOnly');
  const sample=JSON.parse(await readFile(path.join(root,'backend-package/examples/submission-request.json'),'utf8'));
  check((await guest.request('POST','/submissions',sample,{'Idempotency-Key':'guest-test'})).status===401,'Guest cannot create attempts');
  await alice.session();
  const aliceEmail='alice-'+runId+'@example.com',bobEmail='bob-'+runId+'@example.com',password='ExamplePassword42!';
  const registration={name:'Анна',surname:'Пример',email:aliceEmail,password};
  const invalidCSRF=await alice.request('POST','/auth/register',registration,{'X-CSRF-Token':'bad-token'});
  check(invalidCSRF.status===403&&invalidCSRF.json.error.code==='INVALID_CSRF_TOKEN','Registration checks CSRF');
  const oldCookie=alice.cookie,oldCSRF=alice.csrf;
  const registered=await alice.request('POST','/auth/register',registration);
  check(registered.status===201&&registered.json.data.user.name==='Анна','Registration returns user and logs in');
  check(alice.cookie!==oldCookie&&alice.csrf!==oldCSRF,'Authentication rotates session and CSRF');
  check(!JSON.stringify(registered.json).includes('password'),'Password hash never appears in responses');
  check((await alice.session()).json.data.user.email===aliceEmail,'Session restores registered user');
  const attempt=await alice.request('POST','/submissions',sample,{'Idempotency-Key':'lesson-first'});
  check(attempt.status===202&&attempt.json.data.status==='queued','Lesson POST saves an attempt');
  const attemptId=attempt.json.data.id;
  const repeated=await Promise.all(Array.from({length:4},()=>alice.request('POST','/submissions',sample,{'Idempotency-Key':'lesson-first'})));
  check(repeated.every(r=>r.status===202&&r.json.data.id===attemptId),'Concurrent retries return one attempt');
  const changed=structuredClone(sample);changed.files[0].code='changed';
  check((await alice.request('POST','/submissions',changed,{'Idempotency-Key':'lesson-first'})).status===409,'Repeated key with different body is rejected');
  check((await alice.request('GET','/submissions/'+attemptId)).json.data.files[0].code===sample.files[0].code,'Attempt retains original source');
  check((await alice.request('GET','/submissions?lessonId=python-01')).json.data.length===1,'History has no duplicate attempts');
  const task=JSON.parse(await readFile(path.join(root,'backend-package/examples/task-submission-request.json'),'utf8'));
  const taskAttempt=await alice.request('POST','/task-submissions',task,{'Idempotency-Key':'task-first'});
  check(taskAttempt.status===202&&(await alice.request('GET','/task-submissions/'+taskAttempt.json.data.id)).json.data.taskId==='reverse','Separate task POST and GET work');
  await bob.session();check((await bob.request('POST','/auth/register',{name:'Борис',surname:'Пример',email:bobEmail,password})).status===201,'Second account is created');
  check((await bob.request('GET','/submissions/'+attemptId)).status===404,'Other account cannot read source');
  check((await bob.request('GET','/submissions?lessonId=python-01')).json.data.length===0,'History belongs to current account');
  const duplicate=await guest.request('POST','/auth/register',registration);check(duplicate.status===409,'Duplicate email is rejected');
  check((await guest.request('POST','/auth/login',{email:aliceEmail,password:'wrong-password'})).json.error.code==='INVALID_CREDENTIALS','Invalid password has a clear error');
  check((await guest.request('POST','/auth/login',{email:aliceEmail,password})).status===200,'Password login works');
  check((await guest.request('POST','/auth/logout',{})).json.data.user===null,'Logout returns a guest session');
  check((await guest.request('GET','/submissions/'+attemptId)).status===401,'Logged out session cannot read attempts');
  await stopApi();await startApi();
  check((await alice.session()).json.data.user.email===aliceEmail,'Session survives server restart');
  check((await alice.request('GET','/submissions/'+attemptId)).json.data.id===attemptId,'Attempt survives server restart');

  await mkdir(profileDir,{recursive:true});
  browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debugPort,'--user-data-dir='+profileDir,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let tabs;
  for(let i=0;i<80;i++){try{tabs=await (await fetch('http://127.0.0.1:'+debugPort+'/json')).json();if(tabs.some(t=>t.type==='page'))break}catch{}await pause(100)}
  if(!tabs)throw new Error('Edge did not start');
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let next=0;const pending=new Map();
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result)}}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text)};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method))},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||'Browser evaluation failed');return result.result.value};
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(80)}throw new Error('Timeout: '+label)};
  const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
  const input=(selector,value)=>evaluate('{const element=document.querySelector('+JSON.stringify(selector)+');element.value='+JSON.stringify(value)+';element.dispatchEvent(new Event("input",{bubbles:true}));}');
  const submit=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').requestSubmit()');
  const reload=async()=>{await evaluate('window.__leaving=true');await cdp('Page.reload',{ignoreCache:true});await waitFor('!window.__leaving&&window.LKAuth?.ready&&typeof coursesReady!=="undefined"&&coursesReady','reload')};
  const route=async hash=>{await evaluate('location.hash='+JSON.stringify(hash));await pause(150)};
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base+'/'});
  await waitFor('window.LKAuth?.ready&&typeof coursesReady!=="undefined"&&coursesReady','bootstrap');
  check(await evaluate('LKAuth.user===null&&!document.querySelector(".auth-actions").hidden&&document.querySelector(".profile-button").hidden'),'Guest header offers login and registration');
  await click('[data-action="auth-register"]');
  await input('#auth-form [name="name"]','Мария');await input('#auth-form [name="surname"]','Проверка');
  const browserEmail='browser-'+runId+'@example.com';
  await input('#auth-form [name="email"]',browserEmail);await input('#auth-form [name="password"]',password);await input('#auth-form [name="passwordConfirm"]','different-password');await submit('#auth-form');
  check(await evaluate('document.querySelector("#auth-error").textContent.includes("не совпадают")'),'Password confirmation is validated in the form');
  await click('[data-action="auth-password"]');check(await evaluate('document.querySelector("#auth-form [name=password]").type==="text"'),'Password visibility toggle works');
  await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:true});
  check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Registration fits a phone');
  const screenshot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'verification','registration-mobile.png'),Buffer.from(screenshot.data,'base64'));
  await input('#auth-form [name="passwordConfirm"]',password);await submit('#auth-form');
  await waitFor('LKAuth.user?.email==='+JSON.stringify(browserEmail),'browser registration');
  check(await evaluate('!document.querySelector(".profile-button").hidden&&document.querySelector(".auth-actions").hidden'),'Registration updates header');
  check(await evaluate('!Object.values(localStorage).some(value=>value.includes('+JSON.stringify(password)+'))'),'Browser storage contains no password');
  await reload();check(await evaluate('LKAuth.user?.email==='+JSON.stringify(browserEmail)),'Login survives page reload');
  await route('#/settings');await waitFor('!!document.querySelector("#profile-form")','profile settings');
  await input('#profile-form [name="name"]','Марина');await input('#profile-form [name="bio"]','Мой профиль на сервере');await submit('#profile-form');
  await waitFor('LKAuth.user?.name==="Марина"','profile save');await reload();check(await evaluate('LKAuth.user?.bio==="Мой профиль на сервере"'),'Profile changes survive reload');
  await route('#/lesson/python/python-01');await waitFor('!!document.querySelector("#lesson-code")','lesson');
  await input('#lesson-code','print("Черновик Марины")');await pause(350);await click('[data-action="lesson-submit"]');
  await waitFor('document.querySelector("#submission-result")?.textContent.includes("Попытка в очереди")','submission saved');
  await reload();await waitFor('!!document.querySelector("#lesson-code")','restored editor');
  check(await evaluate('document.querySelector("#lesson-code").value.includes("Черновик Марины")'),'Account draft survives reload');
  await click('[data-action="lesson-history-tab"]');await waitFor('document.querySelectorAll(".history-attempt").length===1','attempt history');check(true,'Browser history shows saved attempt');
  await click('[data-action="profile"]');await click('[data-action="auth-logout"]');await waitFor('LKAuth.user===null','logout');
  check(await evaluate('document.querySelector(".profile-button").hidden'),'Logout removes account from header');
  await click('[data-action="auth-login"]');await input('#auth-form [name=email]',browserEmail);await input('#auth-form [name=password]','wrong-password');await submit('#auth-form');
  await waitFor('!document.querySelector("#auth-error").hidden','login error');check(await evaluate('document.querySelector("#auth-error").textContent.includes("Неверная почта или пароль")'),'Server login error is shown in form');
  await input('#auth-form [name=password]',password);await submit('#auth-form');await waitFor('LKAuth.user?.email==='+JSON.stringify(browserEmail),'login');
  await click('[data-action="profile"]');await click('[data-action="auth-logout"]');await waitFor('LKAuth.user===null','second logout');
  await click('[data-action="auth-login"]');await input('#auth-form [name=email]',bobEmail);await input('#auth-form [name=password]',password);await submit('#auth-form');await waitFor('LKAuth.user?.email==='+JSON.stringify(bobEmail),'another account');
  await waitFor('!!document.querySelector("#lesson-code")','second account editor');
  check(await evaluate('!document.querySelector("#lesson-code").value.includes("Черновик Марины")'),'Drafts do not cross accounts');
  await waitFor('document.querySelector("#submission-history")?.textContent.includes("Пока нет отправленных решений")','second account history');check(await evaluate('document.querySelectorAll(".history-attempt").length===0'),'History switches with account');
  check(errors.length===0,'No browser runtime exceptions');
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
  await writeFile(path.join(root,'verification','auth-results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
  await cdp('Browser.close');
}catch(error){console.error(error);console.error(apiOutput.slice(-2500));process.exitCode=1;await writeFile(path.join(root,'verification','auth-results.json'),JSON.stringify({checks,errors,failure:error.message},null,2))}
finally{socket?.close();browser?.kill();await stopApi()}
