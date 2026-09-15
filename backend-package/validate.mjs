import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=async relative=>JSON.parse(await fs.readFile(path.join(root,relative),'utf8'));
// Dependency-free validator for the JSON Schema keywords used by this package.
// The schemas themselves are standard draft 2020-12 and can also be used with Ajv.
function valid(value,schema,document=schema){
  if(schema.$ref){const target=schema.$ref.slice(2).split('/').reduce((v,k)=>v[k],document);return valid(value,target,document)}
  if(schema.const!==undefined&&JSON.stringify(value)!==JSON.stringify(schema.const))return false;
  if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return false;
  if(schema.type){const types=Array.isArray(schema.type)?schema.type:[schema.type];if(!types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):typeof value===t))return false;}
  if(schema.oneOf&&schema.oneOf.filter(s=>valid(value,s,document)).length!==1)return false;
  if(schema.anyOf&&!schema.anyOf.some(s=>valid(value,s,document)))return false;
  if(schema.allOf&&!schema.allOf.every(s=>valid(value,s,document)))return false;
  if(schema.not&&valid(value,schema.not,document))return false;
  if(typeof value==='string'){if(schema.minLength!==undefined&&value.length<schema.minLength)return false;if(schema.maxLength!==undefined&&value.length>schema.maxLength)return false;if(schema.pattern&&!new RegExp(schema.pattern).test(value))return false;}
  if(typeof value==='number'){if(schema.minimum!==undefined&&value<schema.minimum)return false;if(schema.maximum!==undefined&&value>schema.maximum)return false;}
  if(Array.isArray(value)){if(schema.minItems!==undefined&&value.length<schema.minItems)return false;if(schema.maxItems!==undefined&&value.length>schema.maxItems)return false;if(schema.items&&!value.every(v=>valid(v,schema.items,document)))return false;}
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){if(schema.required?.some(k=>!(k in value)))return false;if(schema.additionalProperties===false&&Object.keys(value).some(k=>!Object.hasOwn(schema.properties||{},k)))return false;for(const [key,s]of Object.entries(schema.properties||{}))if(key in value&&!valid(value[key],s,document))return false;}
  return true;
}
let checks=0;function assert(condition,message){checks++;if(!condition)throw new Error(message)}
const manifest=await read('manifest.json'),schema=await read('schemas/content.schema.json'),requestSchema=await read('schemas/submission-request.schema.json'),responseSchema=await read('schemas/submission-response.schema.json');
const catalog=await read('catalog-import.json');const ids=new Set(),exerciseIds=new Set();let paragraphs=0,wordCount=0;const routes={};
for(const entry of manifest.files){const raw=await fs.readFile(path.join(root,entry.file),'utf8');assert(crypto.createHash('sha256').update(raw).digest('hex')===entry.sha256,'Checksum: '+entry.file);const body=JSON.parse(raw);assert(valid(body,schema),'Schema: '+entry.file);routes[entry.endpoint.replace('/api/v1','')]=body;}
assert(catalog.courses.length===manifest.courseCount,'Course count');assert(catalog.lessons.length===manifest.lessonCount,'Lesson count');assert(!catalog.courses.some(c=>c.id==='react'),'Removed course absent');
assert(catalog.courses.length===11&&catalog.lessons.length===660,'Fivefold curriculum size');
for(const course of catalog.courses){
  assert(course.lessons===60&&course.modules.length===20,'Complete expanded track '+course.id);
  const lessons=catalog.lessons.filter(l=>l.courseId===course.id);
  assert(new Set(lessons.map(l=>l.title)).size===60,'Unique lesson titles '+course.id);
  assert(lessons.filter(l=>l.exercise.review?.kind==='implementation').length===16,'Implementation workshops '+course.id);
  assert(lessons.filter(l=>l.exercise.review?.kind==='verification').length===16,'Verification workshops '+course.id);
  assert(lessons.filter(l=>l.exercise.review?.kind==='project').length===16,'Project workshops '+course.id);
  assert(lessons[11].navigation.nextId===`${course.id}-13`&&lessons[59].navigation.nextId===null,'Expanded navigation boundaries '+course.id);
}
assert(manifest.courseFiles.length===manifest.courseCount,'Standalone course file count');
const profiles=(await read('runtime-profiles.json')).profiles;
for(const entry of manifest.courseFiles){
  const single=await read(entry.json),course=catalog.courses.find(c=>c.id===entry.courseId);
  assert(single.schemaVersion===manifest.schemaVersion&&single.contentVersion===manifest.contentVersion,'Standalone version '+entry.courseId);
  assert(JSON.stringify(single.course)===JSON.stringify(course),'Standalone course '+entry.courseId);
  assert(JSON.stringify(single.lessons)===JSON.stringify(catalog.lessons.filter(l=>l.courseId===entry.courseId)),'Standalone lessons '+entry.courseId);
  const markdown=await fs.readFile(path.join(root,entry.markdown),'utf8');
  assert(single.lessons.every(l=>markdown.includes(`## Урок ${l.position+1}. ${l.title}`)&&markdown.includes(l.exercise.prompt)),'Readable course '+entry.courseId);
}
for(const course of catalog.courses){const refs=course.modules.flatMap(m=>m.lessons);assert(refs.length===course.lessons,'Course lesson count '+course.id);assert(refs.every((l,i)=>l.position===i),'Ordered positions '+course.id);assert(refs.every(l=>catalog.lessons.some(x=>x.id===l.id&&x.courseId===course.id)),'Course references '+course.id);assert(JSON.stringify(course)===JSON.stringify(routes['/courses/'+course.id].data),'Import/API equality '+course.id);}
for(const lesson of catalog.lessons){assert(!ids.has(lesson.id),'Unique lesson '+lesson.id);ids.add(lesson.id);assert(!exerciseIds.has(lesson.exercise.id),'Unique exercise '+lesson.id);exerciseIds.add(lesson.exercise.id);assert(JSON.stringify(lesson)===JSON.stringify(routes['/lessons/'+lesson.id].data),'Import/API equality '+lesson.id);assert(lesson.blocks.some(b=>b.type==='code')&&lesson.blocks.some(b=>b.type==='steps'),'Explained code '+lesson.id);assert(lesson.exercise.files.some(f=>f.path===lesson.exercise.entryFile),'Entry file '+lesson.id);assert(lesson.exercise.grading.hiddenTestsIncluded===false,'No hidden tests shipped '+lesson.id);assert(!lesson.exercise.files.some(f=>f.path.includes('..')||f.path.startsWith('/')),'Safe file paths '+lesson.id);
  const text=lesson.blocks.flatMap(b=>[b.text,...(b.items||[]).filter(x=>typeof x==='string')]).filter(Boolean).join(' ');wordCount+=text.split(/\s+/).length;paragraphs+=lesson.blocks.filter(b=>b.type==='paragraph').length;assert(text.split(/\s+/).length>=250,'Substantial lesson '+lesson.id);
  assert(profiles.some(p=>p.id===lesson.exercise.runtimeProfileId&&p.language===lesson.exercise.language&&p.entryFile===lesson.exercise.entryFile),'Runtime profile '+lesson.id);
  assert(lesson.completionPolicy==='server_accepted_submission','Completion matches implemented frontend '+lesson.id);
  if(lesson.position>=12){
    assert(lesson.exercise.grading.strategy==='review'&&lesson.exercise.review.criteria.length>=3,'Review rubric '+lesson.id);
    assert(lesson.exercise.files.length>=3&&lesson.exercise.files.some(f=>f.path.endsWith('.md')),'Source and evidence files '+lesson.id);
    assert(lesson.objectives.length>=3&&lesson.estimatedMinutes>=80,'Advanced learning objectives '+lesson.id);
  }
  for(const next of [lesson.navigation.previousId,lesson.navigation.nextId])if(next)assert(catalog.lessons.some(l=>l.id===next&&l.courseId===lesson.courseId),'Navigation '+lesson.id);
}
assert(valid(await read('examples/submission-request.json'),requestSchema),'Submission request example');
const reviewRequest=await read('examples/submission-review-request.json');
assert(valid(reviewRequest,requestSchema),'Engineering submission request schema');
const reviewLesson=catalog.lessons.find(l=>l.id===reviewRequest.lessonId);
assert(reviewLesson.exercise.runtimeProfileId===reviewRequest.runtimeProfileId&&reviewLesson.exercise.version===reviewRequest.exerciseVersion,'Engineering request uses published version and profile');
assert(JSON.stringify(reviewRequest.files.map(f=>f.path))===JSON.stringify(reviewLesson.exercise.files.map(f=>f.path)),'Engineering request contains all source and document paths');
for(const file of ['submission-queued.json','submission-accepted.json','submission-compilation-error.json','submission-wrong-answer.json'])assert(valid(await read('examples/'+file),responseSchema),'Submission response '+file);
const invalid=structuredClone(await read('examples/submission-accepted.json'));invalid.data.verdict=null;
assert(!valid(invalid,responseSchema),'Reject finished submission without verdict');
const invalidRequest=structuredClone(await read('examples/submission-request.json'));invalidRequest.exerciseVersion='1';
assert(!valid(invalidRequest,requestSchema),'Reject string exercise version');
const taskRequestSchema=await read('schemas/task-submission-request.schema.json'),taskResponseSchema=await read('schemas/task-submission-response.schema.json');
assert(valid(await read('examples/task-submission-request.json'),taskRequestSchema),'Task request example');
assert(valid(await read('examples/task-submission-accepted.json'),taskResponseSchema),'Task response example');
const standaloneTasks=await read('task-import.json');
assert(standaloneTasks.tasks.length===6,'Standalone task count');
assert(new Set(standaloneTasks.tasks.map(t=>t.id)).size===6,'Unique task IDs');
assert(standaloneTasks.tasks.every(t=>!('tests' in t)&&!('solution' in t)&&profiles.some(p=>p.id===t.runtimeProfileId&&p.entryFile===t.entryFile)),'Public task metadata and server profiles');
try {const context=vm.createContext({window:{}});vm.runInContext(await fs.readFile(path.resolve(root,'../content/mock-bundle.js'),'utf8'),context);assert(JSON.stringify(context.window.LK_MOCK_BUNDLE.endpoints)===JSON.stringify(routes),'Mock bundle equals exported release DTOs');}catch(error){if(error.code!=='ENOENT')throw error;console.log('Standalone package: frontend bundle equality check skipped.');}
const report={checks,courses:catalog.courses.length,lessons:catalog.lessons.length,exercises:exerciseIds.size,theoryWords:wordCount,explanatoryParagraphs:paragraphs,errors:0};
await fs.writeFile(path.join(root,'validation-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
