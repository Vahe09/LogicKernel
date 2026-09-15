import {writeFile} from 'node:fs/promises';

const content='./schemas/content.schema.json';
const contentResponse=data=>({allOf:[{$ref:content},{type:'object',properties:{data}}]});
const jsonResponse=(description,schema)=>({description,content:{'application/json':{schema}}});
const error={type:'object',required:['error'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'},details:{},requestId:{type:'string'}}}}};
const errors={default:jsonResponse('Ошибка API; см. error.code и error.message',error)};
const parameter=(name,location='path')=>({name,in:location,required:true,schema:{type:'string',minLength:1}});
const submission={$ref:'./schemas/submission-response.schema.json'};
const doc={
  openapi:'3.1.0',info:{title:'LogicKernel Content and Submissions API',version:'1.0',description:'Контракт текущего фронтенда. Полное руководство: BACKEND.md. Авторизация и синхронизация профиля/прогресса требуют отдельной интеграции.'},
  servers:[{url:'/api/v1',description:'Same-origin API'},{url:'http://127.0.0.1:4180/api/v1',description:'Локальный пример API материалов'}],
  paths:{
    '/courses':{get:{operationId:'listCourses',summary:'Весь каталог без пагинации',responses:{200:jsonResponse('Все карточки курсов',contentResponse({type:'array',items:{$ref:content+'#/$defs/courseSummary'}})),...errors}}},
    '/courses/{courseId}':{get:{operationId:'getCourse',summary:'Программа курса с модулями',parameters:[parameter('courseId')],responses:{200:jsonResponse('Курс',contentResponse({$ref:content+'#/$defs/course'})),...errors}}},
    '/lessons/{lessonId}':{get:{operationId:'getLesson',summary:'Полный урок с упражнением',parameters:[parameter('lessonId')],responses:{200:jsonResponse('Урок',contentResponse({$ref:content+'#/$defs/lesson'})),...errors}}},
    '/submissions':{
      get:{operationId:'listSubmissions',summary:'Последние 20 попыток пользователя по уроку, новые первыми',parameters:[parameter('lessonId','query')],responses:{200:jsonResponse('Попытки с исходными снимками кода; пустой массив допустим',{type:'object',required:['data','meta'],properties:{data:{type:'array',items:{$ref:'./schemas/submission-response.schema.json#/properties/data'}},meta:{type:'object',required:['schemaVersion'],properties:{schemaVersion:{const:'1.0'}}}}}),...errors}},
      post:{operationId:'submit',summary:'Сохранить снимок решения и поставить проверку в очередь',parameters:[parameter('Idempotency-Key','header'),{name:'X-CSRF-Token',in:'header',required:false,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{$ref:'./schemas/submission-request.schema.json'}}}},responses:{202:jsonResponse('Попытка создана или возвращена по ключу идемпотентности',submission),...errors}}
    },
    '/submissions/{submissionId}':{get:{operationId:'getSubmission',summary:'Статус, результат и исходный снимок решения',parameters:[parameter('submissionId')],responses:{200:jsonResponse('Попытка',submission),...errors}}},
    '/task-submissions':{post:{operationId:'submitTask',summary:'Отправить решение отдельной задачи',parameters:[parameter('Idempotency-Key','header')],requestBody:{required:true,content:{'application/json':{schema:{$ref:'./schemas/task-submission-request.schema.json'}}}},responses:{202:jsonResponse('Попытка проверки задачи',{$ref:'./schemas/task-submission-response.schema.json'}),...errors}}},
    '/task-submissions/{submissionId}':{get:{operationId:'getTaskSubmission',summary:'Результат отдельной задачи',parameters:[parameter('submissionId')],responses:{200:jsonResponse('Попытка проверки задачи',{$ref:'./schemas/task-submission-response.schema.json'}),...errors}}}
  }
};
await writeFile(new URL('../backend-package/openapi.json',import.meta.url),JSON.stringify(doc,null,2)+'\n');
