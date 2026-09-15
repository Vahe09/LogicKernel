import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let source=await fs.readFile(path.join(root,'app.js'),'utf8');
if(!source.includes('const courses = ['))throw new Error('Upgrade already applied or unexpected source');
source=source.replace(/const courses = \[[\s\S]*?\n\];\nconst lessonNames = \{[\s\S]*?\n\};/,'const courses = [];\nlet coursesReady = false;');
source=source.split('\n').filter(line=>!line.includes("if (id === 'react')")&&!line.includes("{id:'react-hooks'")&&!line.startsWith('const lessonExamples=')&&!line.startsWith('const lessonDescriptions=')&&!line.startsWith("case 'complete-lesson':")&&!line.startsWith("case 'lesson-resource':")&&!line.startsWith("case 'lesson-presentation':")).join('\n');
source=source.replace(" if (id === 'algorithms')",` if (['csharp','c','cpp','go','rust'].includes(id)) { const labels={csharp:'C#',c:'C',cpp:'C++',go:'Go',rust:'Rs'}; const colors={csharp:'#8d61cd',c:'#5778aa',cpp:'#3976be',go:'#09aabd',rust:'#a46b4c'}; return '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="12" fill="'+colors[id]+'"/><text x="24" y="31" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="'+(id==='cpp'?17:23)+'" fill="white">'+labels[id]+'</text></svg>'; }\n if (id === 'algorithms')`);
source=source.replace("enrolled:['python','js','algorithms','react']","enrolled:['python','js','algorithms','csharp']");
source=source.replace("let courseFilter='all'",`if(state.curriculumVersion !== '2026.09.14.1') {state.legacyCompleted=state.completed;state.completed={};state.curriculumVersion='2026.09.14.1';}
state.enrolled=state.enrolled.filter(id=>id!=='react');
if(!state.enrolled.includes('csharp'))state.enrolled.push('csharp');
state.bookmarks=state.bookmarks.filter(id=>id!=='react-hooks');
state.lessonDrafts=state.lessonDrafts&&typeof state.lessonDrafts==='object'?state.lessonDrafts:{};
state.lessonReads=Array.isArray(state.lessonReads)?state.lessonReads:[];
state.lessonChecks=state.lessonChecks&&typeof state.lessonChecks==='object'?state.lessonChecks:{};
let courseFilter='all'`);
source=source.replace(/function progress\(course\)\{[^\n]+/,"function progress(course){return Math.min(100,Math.round(new Set(state.completed[course.id]||[]).size/course.lessons*100));}");
source=source.replace(/function lessonPage\(id,index\)\{[^\n]+/,"function lessonPage(){return '<div class=\"panel lesson-loading\" role=\"status\">'+icon('book',30)+'<h2>Открываем урок…</h2><p>Загружаем теорию и практику.</p></div>';}");
source=source.replace('function render(){closeModal();','function render(){if(!coursesReady)return;window.LKLesson.dispose();closeModal();');
source=source.replace("page==='lesson'?'courses'","(page==='lesson'||page==='course')?'courses'");
source=source.replace("page==='lesson'?lessonPage(id,index===undefined?undefined:Number(index))","(page==='lesson'||page==='course')?lessonPage()");
source=source.replace("$('.sidebar').classList.remove('open');updateHeader();}","$('.sidebar').classList.remove('open');updateHeader();if(page==='lesson')window.LKLesson.mount(id,index);if(page==='course')window.LKLesson.mountCourse(id);}");
source=source.replace("['fundamentals','Алгоритмы']","['fundamentals','Алгоритмы'],['systems','Системные языки']");
source=source.replace('href="#/lesson/python/3"','href="#/lesson/python/0"').replace('<b>Функции в Python</b>','<b>Первая программа</b>').replace('href="#/lesson/python/4"','href="#/lesson/python/1"').replace('<b>Модули и пакеты</b>','<b>Структура кода и комментарии</b>');
source=source.replace('В прототипе доступно 6 демонстрационных уроков.','В курсе 12 подробных уроков с редактором и практикой после каждого.');
source=source.replace("case 'course-info':{", "case 'course-info':location.hash='#/course/'+id;break;case 'legacy-course-info':{");
source=source.replace('</div></article>`).join(\'\'):empty(\'Курсы не найдены\'', '</div><a class="catalog-syllabus" href="#/course/${c.id}">Программа курса ${icon(\'arrow\',13)}</a></article>`).join(\'\'):empty(\'Курсы не найдены\'');
source=source.replace("case 'sidebar':", "case 'retry-bootstrap':bootstrapCourses();break;case 'sidebar':");
source=source.replace("case 'confirm-reset':state=structuredClone(defaults);", "case 'confirm-reset':state=structuredClone(defaults);state.lessonDrafts={};state.lessonReads=[];state.lessonChecks={};state.curriculumVersion='2026.09.14.1';LKApi.debug.clearHistory();");
source=source.replace('«React»','«Go»').replace('«Python», «массивы» или «React»','«Python», «массивы» или «Go»');
for(const variable of ['c','course'])for(const field of ['title','subtitle','description','teacher','level'])source=source.replaceAll('${'+variable+'.'+field+'}','${escapeHTML('+variable+'.'+field+')}');
source=source.replace(/\nrender\(\);\s*$/,`\nasync function bootstrapCourses(){
  $('#main').innerHTML='<div class="panel lesson-loading" role="status">'+icon('book',30)+'<h2>Загружаем курсы…</h2></div>';
  try {const response=await LKApi.listCourses();if(!Array.isArray(response.data))throw new Error('Некорректный каталог');courses.splice(0,courses.length,...response.data);state.enrolled=state.enrolled.filter(id=>courses.some(c=>c.id===id));coursesReady=true;render();}
  catch(error){$('#main').innerHTML='<div class="panel lesson-loading"><h2>Не удалось загрузить курсы</h2><p>'+escapeHTML(error.message)+'</p><button class="button primary" data-action="retry-bootstrap">Повторить</button></div>';}
}
bootstrapCourses();\n`);
await fs.writeFile(path.join(root,'app.js'),source);
let html=await fs.readFile(path.join(root,'index.html'),'utf8');html=html.replace('  <script src="app.js" defer></script>','  <script src="config.js" defer></script>\n  <script src="api.js" defer></script>\n  <script src="lesson-view.js" defer></script>\n  <script src="app.js" defer></script>');await fs.writeFile(path.join(root,'index.html'),html);
console.log('App upgraded to the versioned curriculum API.');
