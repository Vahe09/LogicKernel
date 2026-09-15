/* Transport boundary: mock and HTTP return the same versioned DTO envelopes. */
window.LKApi = (() => {
  const config=window.LK_CONFIG;
  let mockReady;
  let nextFailure=null;
  const log=[];
  class ApiError extends Error{constructor(code,message,status=0,details=null){super(message);this.name='ApiError';this.code=code;this.status=status;this.details=details;}}
  function loadMock(){return mockReady??=new Promise((resolve,reject)=>{if(window.LK_MOCK_BUNDLE)return resolve();const script=document.createElement('script');script.src='content/mock-bundle.js';script.onload=resolve;script.onerror=()=>{mockReady=null;script.remove();reject(new ApiError('CONTENT_LOAD_FAILED','Не удалось загрузить учебные материалы. Проверьте наличие папки content.'))};document.head.append(script)})}
  function validateEnvelope(value){if(!value||typeof value!=='object'||!('data'in value)||value.meta?.schemaVersion!=='1.0')throw new ApiError('INVALID_RESPONSE','Сервер вернул ответ неизвестного формата.');return value;}
  function safeLog(method,path,body,result){log.push({time:new Date().toISOString(),method,path:'/api/v1'+path,request:body?structuredClone(body):null,response:result?structuredClone(result):null});if(log.length>50)log.shift()}
  async function request(method,path,body,{signal,idempotencyKey}={}){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(config.mode==='http'){
      const controller=new AbortController();const onAbort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',onAbort,{once:true});const timer=setTimeout(()=>controller.abort(),config.requestTimeoutMs);
      try{const headers={Accept:'application/json'};if(body)headers['Content-Type']='application/json';if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;const csrf=document.querySelector('meta[name="csrf-token"]')?.content;if(method!=='GET'&&csrf)headers['X-CSRF-Token']=csrf;
        const response=await fetch(config.baseUrl+path,{method,headers,body:body?JSON.stringify(body):undefined,credentials:'same-origin',signal:controller.signal});let json;try{json=await response.json()}catch{throw new ApiError('INVALID_RESPONSE','Ответ сервера не является JSON.',response.status)}if(!response.ok)throw new ApiError(json.error?.code||'HTTP_ERROR',json.error?.message||'Не удалось выполнить запрос.',response.status,json.error?.details);return validateEnvelope(json);
      }catch(error){if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(error.name==='AbortError')throw new ApiError('TIMEOUT','Сервер не ответил вовремя. Сохранённый код не потерян.');if(error instanceof ApiError)throw error;throw new ApiError('NETWORK_ERROR','Нет связи с сервером. Проверьте подключение и повторите.');}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort)}
    }
    await loadMock();await new Promise(resolve=>setTimeout(resolve,config.mockLatencyMs));if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(nextFailure){const failure=nextFailure;nextFailure=null;throw new ApiError(failure,'Демонстрационная ошибка связи. Попробуйте ещё раз.',503)}
    const meta={schemaVersion:'1.0',mode:'mock'};let result;
    if(method==='GET'&&window.LK_MOCK_BUNDLE.endpoints[path])result=structuredClone(window.LK_MOCK_BUNDLE.endpoints[path]);
    else if(method==='POST'&&(path==='/submissions'||path==='/task-submissions'))throw new ApiError('PROJECT_IN_DEVELOPMENT','Проект ещё в разработке, отправка решений появится после подключения бэкенда',503);
    else if(method==='GET'&&path.startsWith('/submissions?'))result={data:[],meta};
    else throw new ApiError('NOT_FOUND','Материал не найден',404);
    safeLog(method,path,body,result);return validateEnvelope(result);
  }
  return Object.freeze({mode:config.mode,ApiError,listCourses:options=>request('GET','/courses',null,options),getCourse:(id,options)=>request('GET','/courses/'+encodeURIComponent(id),null,options),getLesson:(id,options)=>request('GET','/lessons/'+encodeURIComponent(id),null,options),submit:(body,options)=>request('POST','/submissions',body,options),submitTask:(body,options)=>request('POST','/task-submissions',body,options),getTaskSubmission:(id,options)=>request('GET','/task-submissions/'+encodeURIComponent(id),null,options),getSubmission:(id,options)=>request('GET','/submissions/'+encodeURIComponent(id),null,options),listSubmissions:(lessonId,options)=>request('GET','/submissions?lessonId='+encodeURIComponent(lessonId),null,options),debug:Object.freeze({getLog:()=>structuredClone(log),failNext:code=>{if(config.mode==='mock')nextFailure=code||'NETWORK_ERROR';}})});
})();
