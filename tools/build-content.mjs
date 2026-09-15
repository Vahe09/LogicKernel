import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context=vm.createContext({window:{}});
for(const file of ['curriculum.js','systems.js','web-and-data.js'])vm.runInContext(await fs.readFile(path.join(root,'content',file),'utf8'),context);
const {meta,specs}=context.window.LKCurriculum;
vm.runInContext(await fs.readFile(path.join(root,'content/advanced-core.js'),'utf8'),context);
for(const [id] of meta)vm.runInContext(await fs.readFile(path.join(root,`content/advanced-${id}.js`),'utf8'),context);
const advanced=context.window.LKAdvanced;
for(const [id,,,,filename,language] of meta)specs[id].push(...advanced.expand(id,language,filename));
const version='2026.09.15.1';
const envelope=data=>({data,meta:{schemaVersion:'1.0',contentVersion:version}});
const modules=['Первые шаги и устройство кода','Данные и управление программой','Коллекции и повторное использование','Надёжность и самостоятельный проект'];
const moduleNames={html:['Как устроена веб-страница','Содержание и взаимодействие','Оформление и раскладка','Адаптивность и свой проект'],sql:['Основы таблиц и запросов','Отбор и порядок данных','Агрегации и группы','Связи, изменения и отчёты'],algorithms:['От задачи к инструкциям','Инструменты решения','Поиск и оценка сложности','Структуры и самостоятельный проект']};
const sources={python:['https://docs.python.org/3/tutorial/','Официальное руководство Python'],js:['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide','Руководство JavaScript от MDN'],algorithms:['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide','Справочник синтаксиса JavaScript'],html:['https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content','HTML: учебные материалы MDN'],sql:['https://www.sqlite.org/lang.html','Официальная документация SQLite'],ts:['https://www.typescriptlang.org/docs/handbook/intro.html','TypeScript Handbook'],csharp:['https://learn.microsoft.com/en-us/dotnet/csharp/','Документация C# от Microsoft'],c:['https://www.gnu.org/software/c-intro-and-ref/manual/html_node/','GNU C Language Introduction'],cpp:['https://isocpp.org/get-started','Материалы ISO C++'],go:['https://go.dev/tour/','Официальный Tour of Go'],rust:['https://doc.rust-lang.org/book/','The Rust Programming Language']};
const starters={python:'# Напишите решение ниже\n',javascript:'// Напишите решение ниже\n',typescript:'// Напишите решение ниже\n',csharp:'// Напишите решение ниже\n',c:'#include <stdio.h>\n\nint main(void)\n{\n    // Напишите решение здесь\n    return 0;\n}\n',cpp:'#include <iostream>\n\nint main()\n{\n    // Напишите решение здесь\n    return 0;\n}\n',go:'package main\n\nimport "fmt"\n\nfunc main() {\n    // Напишите решение здесь. Используйте fmt для вывода.\n}\n',rust:'fn main() {\n    // Напишите решение здесь\n}\n',html:'<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Моя практика</title>\n  <style>\n    /* Ваши стили */\n  </style>\n</head>\n<body>\n  <!-- Ваша разметка -->\n</body>\n</html>\n',sql:'-- Учебные таблицы уже подготовлены будущей средой проверки.\n-- Напишите запрос ниже.\n'};
const glossary={python:[['Интерпретатор','Программа, которая выполняет инструкции исходного кода.'],['Аргумент','Конкретное значение, передаваемое при вызове функции.'],['Отступ','Пробелы в начале строки; в Python они задают вложенность.']],js:[['Инструкция','Отдельное действие в исходном коде.'],['Выражение','Запись, вычисление которой даёт значение.'],['Консоль','Текстовая область вывода и сообщений.']],algorithms:[['Вход','Данные, которые получает алгоритм.'],['Выход','Результат обработки входа.'],['Граничный случай','Вход на важной границе: пустой набор, ноль или порог.']],html:[['Элемент','Часть документа: например, абзац с содержимым.'],['Атрибут','Свойство, записанное в открывающем теге.'],['Селектор','Правило выбора элементов для применения CSS.']],sql:[['Запись','Одна строка таблицы.'],['Колонка','Одно именованное свойство всех записей таблицы.'],['Запрос','Инструкция для получения или изменения данных.']],ts:[['Аннотация','Явное описание типа в исходном коде.'],['Проверка типов','Анализ совместимости значений до выполнения.'],['Выполнение','Реальная работа полученного JavaScript-кода.']],csharp:[['Компиляция','Проверка и преобразование исходной программы.'],['Метод','Именованное действие, принимающее аргументы.'],['Тип','Описание допустимого вида значения и операций.']],c:[['Компилятор','Инструмент перевода исходного кода в исполняемую форму.'],['Инициализация','Задание начального значения переменной.'],['Адрес','Положение объекта в памяти.']],cpp:[['Заголовок','Файл с объявлениями, подключаемый через #include.'],['Стандартная библиотека','Готовые средства языка, например строки и векторы.'],['Объект','Конкретное значение с типом и временем жизни.']],go:[['Пакет','Группа связанных определений Go.'],['Импорт','Подключение доступных имён другого пакета.'],['Срез','Представление последовательности элементов.']],rust:[['Связывание','Связь имени с конкретным значением.'],['Изменяемость','Разрешение менять значение или данные.'],['Заимствование','Временный доступ к данным без передачи владения.']]};
const sqlFixture={id:'school-sqlite-v1',label:'Учебная база school · SQLite',tables:[{name:'students',columns:['id','name','score','city','course_id'],rows:[[1,'Аня',80,'Ереван',1],[2,'Борис',60,null,1],[3,'Вера',95,'Москва',2]]},{name:'courses',columns:['id','title'],rows:[[1,'Python'],[2,'Go']]}]};
const endpoints={},allCourses=[],allLessons=[];
for(const [id,title,subtitle,category,filename,language,description,intro,structure] of meta){
  if(!specs[id]||specs[id].length!==60)throw new Error('Expected 60 lessons: '+id);
  const count=specs[id].length;
  const course={id,slug:id,title,subtitle:`${title}, от первых шагов к инженерной практике`,description:description+' Продолжение программы включает разработку компонентов, проверку ошибок, архитектуру, производительность и проектные работы',level:'С нуля до продвинутого',category,language,base:0,hours:0,lessons:count,teacher:'Редакция LogicKernel',version,prerequisites:'Первые 12 уроков можно пройти без опыта, следующие модули опираются на предыдущие, продвинутые проекты требуют самостоятельной работы и ревью',outcomes:[`Читать, писать и объяснять код ${title}`,'Проверять контракты, граничные случаи и поведение при отказе','Обосновывать структуру проекта, работу с данными и ресурсами','Измерять производительность и сохранять корректность при оптимизации','Подготовить итоговый проект и защитить инженерные решения'],modules:[]};
  const names=[...(moduleNames[id]||modules),...advanced.tracks[id].map(u=>u[0])];
  for(let m=0;m<count/3;m++)course.modules.push({id:`${id}-module-${m+1}`,title:names[m],position:m,lessons:[]});
  for(const [i,spec] of specs[id].entries()){
    const lessonId=`${id}-${String(i+1).padStart(2,'0')}`;
    const practiceId=`${lessonId}-practice`;
    const goals=spec.objectives||(i===0?[`Объяснить, что представляет собой ${title} и как выглядит исходный файл`,'Найти в примере структуру и основную инструкцию','Самостоятельно изменить сообщение и написать первую программу']:[`Объяснить своими словами тему «${spec.title}»`,'Проследить работу примера по шагам и предсказать результат','Применить новый приём в самостоятельном задании']);
    const steps=i===0?[
      'Сначала прочитайте пример целиком. Пока не копируйте его: найдите имена команд, кавычки и границы блоков. Если символ непонятен, сопоставьте его с разбором ниже.',
      'Перепечатайте маленький пример самостоятельно. Так вы заметите разницу между кавычкой, скобкой и знаком завершения инструкции. Не вводите номера строк: они принадлежат интерфейсу редактора.',
      'Измените только один фрагмент, например текст сообщения. До проверки запишите ожидаемый результат словами. Важно понимать связь между изменением кода и результатом, а не просто получить зелёный индикатор.',
      'После этого решите задание в конце урока. Шаблон содержит основу файла; допишите недостающие инструкции. Сейчас проект ещё в разработке, можно сохранить черновик, отправка решения появится после подключения бэкенда'
    ]:[
      `Начните с условия практики: «${spec.assignment}». Выделите исходные данные и то, что должно получиться. Не добавляйте возможности, которых нет в задаче: сначала реализуйте минимально нужное поведение.`,
      'Составьте короткий план: подготовить данные, выполнить действие из урока, сформировать результат. Для каждой переменной выберите имя по смыслу. Если используете блок, визуально отделите его от соседних инструкций.',
      `Используйте разбор примера как ориентир, но не переносите его значения бездумно: в упражнении вход или текст может отличаться. Отдельно проверьте этот риск: ${spec.mistake}`,
      'Сопоставьте написанное с ожидаемым результатом. Если поведение не совпадает, меняйте одну причину за раз. Сохранённый черновик позволит вернуться позже. Отправка попытки сама по себе ещё не означает, что решение правильное.'
    ];
    const blocks=[
      {id:`${lessonId}-welcome`,type:'callout',tone:'info',title:i===0?'Начинаем с самого начала':'Перед началом',text:i===0?intro:`Этот урок продолжает предыдущую тему «${specs[id][i-1].title}». Если пример пока трудно читать, вернитесь к ней по программе справа. Здесь добавляем следующий приём и закрепляем его отдельным заданием.`},
      ...spec.explanation.split('\n').map((text,n)=>({id:`${lessonId}-concept-${n}`,type:'paragraph',text})),
      {id:`${lessonId}-structure`,type:'reference',title:i<12?'Как писать и структурировать код':'Контракт и сдаваемые материалы',text:i<12?structure:'Исходный файл содержит реализацию, дополнительные файлы отделяют компонент и подтверждающие материалы, условия, границы и критерии проверки находятся в практике, проектная работа оценивается по реализации и обоснованию решения'},
      {id:`${lessonId}-example`,type:'code',title:spec.exampleLanguage==='markdown'?'Пример инженерного документа':'Разбираемый пример',language:spec.exampleLanguage||language,filename:spec.exampleFilename||filename,code:spec.code},
      {id:`${lessonId}-walkthrough`,type:'steps',title:'Разбираем пример по шагам',items:spec.walkthrough},
      {id:`${lessonId}-mistake`,type:'callout',tone:'warning',title:'Ошибка, которую легко допустить',text:spec.mistake},
      {id:`${lessonId}-workflow`,type:'steps',title:'От условия к собственному решению',items:steps},
      {id:`${lessonId}-glossary`,type:'glossary',title:'Слова, которые стоит понимать',items:spec.glossary||glossary[id].map(([term,definition])=>({term,definition}))},
      {id:`${lessonId}-recap`,type:'checklist',title:'Проверьте понимание',items:[`Я могу объяснить основную идею темы «${spec.title}» без чтения примера.`,'Я понимаю, какие строки относятся к структуре файла, а какие решают конкретную задачу.','Я могу предсказать, что изменится при замене одного входного значения.','Я отличаю сохранённый черновик, отправленную попытку и подтверждённый результат проверки.']}
    ];
    const exercise={id:practiceId,version:1,title:`Практика: ${spec.title}`,prompt:spec.assignment,language,runtimeProfileId:i<12?`${language}-intro-v1`:id==='sql'&&i>=48?'sql-postgresql-engineering-v1':`${language}-engineering-v1`,files:[{path:filename,language,editable:true,starterCode:starters[language]}],entryFile:filename,stdin:{enabled:language!=='html'&&language!=='sql',defaultValue:'',label:'Стандартный ввод (stdin)',help:'В текущем задании ввод не требуется. Для будущих задач здесь можно передавать текстовые входные данные.'},publicExamples:[{id:`${practiceId}-example`,input:'',expectedOutput:spec.expected,description:language==='html'?'Ожидаемая структура страницы':language==='sql'?'Ожидаемый смысл результата запроса':'Ожидаемый вывод программы'}],hints:[spec.hint,'Сверьте пунктуацию и имена с разбором выше. Затем пройдите каждый шаг программы вручную.'],constraints:{maxCodeBytes:65536,maxStdinBytes:8192,timeLimitMs:2000,memoryLimitMb:128},grading:{strategy:i>=12?'review':language==='html'?'document':language==='sql'?'query':'program',serverOnly:true,hiddenTestsIncluded:false},...(id==='sql'?{fixture:i>=48?{...sqlFixture,id:'school-postgresql-v1',label:'Учебная база school, PostgreSQL'}:sqlFixture}:{}),...(spec.review?{review:spec.review}:{})};
    if(i>=12){
      const componentFiles={python:['component.py','python','# Компонент проекта\n'],javascript:['component.js','javascript','// Компонент проекта\n'],typescript:['component.ts','typescript','// Компонент проекта\n'],csharp:['Components.cs','csharp','// Компонент проекта\n'],c:['component.h','c','#ifndef LK_COMPONENT_H\n#define LK_COMPONENT_H\n\n#endif\n'],cpp:['component.hpp','cpp','#pragma once\n'],go:['component.go','go','package main\n'],rust:['components.rs','rust','// Компонент проекта\n'],html:['styles.css','css','/* Стили проекта */\n'],sql:['schema.sql','sql','-- Дополнительная схема упражнения\n']};
      const [componentPath,componentLanguage,componentCode]=componentFiles[language];
      exercise.files.push({path:componentPath,language:componentLanguage,editable:true,starterCode:componentCode},...spec.additionalFiles);
      exercise.stdin.enabled=false;
      exercise.publicExamples[0].description='Критерии приёмки работы';
      exercise.stdin.help='Ввод и окружение описываются в контракте проектной работы';
      exercise.hints=[spec.hint,'Сопоставьте реализацию и подтверждающие материалы с критериями, объясните выбранные ограничения и альтернативы'];
    }
    const lesson={id:lessonId,courseId:id,moduleId:course.modules[Math.floor(i/3)].id,position:i,slug:lessonId,title:spec.title,version:1,estimatedMinutes:spec.estimatedMinutes||(35+i*2),level:spec.level||'Начинающий',objectives:goals,blocks,exercise,references:id==='sql'&&i>=48?[{label:'Документация PostgreSQL 16',url:'https://www.postgresql.org/docs/16/'},{label:'Изоляция транзакций',url:'https://www.postgresql.org/docs/16/transaction-iso.html'}]:id==='algorithms'&&i>=12?[{label:'MIT, Introduction to Algorithms',url:'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/'}]:[{label:sources[id][1],url:sources[id][0]}],navigation:{previousId:i?`${id}-${String(i).padStart(2,'0')}`:null,nextId:i<count-1?`${id}-${String(i+2).padStart(2,'0')}`:null},completionPolicy:'server_accepted_submission'};
    course.modules[Math.floor(i/3)].lessons.push({id:lessonId,title:spec.title,position:i,estimatedMinutes:lesson.estimatedMinutes,hasPractice:true});
    endpoints[`/lessons/${lessonId}`]=envelope(lesson);allLessons.push(lesson);
  }
  course.hours=Math.round(course.modules.flatMap(m=>m.lessons).reduce((sum,l)=>sum+l.estimatedMinutes,0)/60);
  endpoints[`/courses/${id}`]=envelope(course);
  const {modules:omitted,...summary}=course;allCourses.push(summary);
}
endpoints['/courses']={...envelope(allCourses),meta:{...envelope(null).meta,total:allCourses.length,nextCursor:null}};
const bundle={schemaVersion:'1.0',contentVersion:version,endpoints};
const exportRoot=path.join(root,'backend-package');await fs.mkdir(exportRoot,{recursive:true});
const files=[];
for(const [endpoint,body]of Object.entries(endpoints)){
  const relative=endpoint==='/courses'?'responses/courses/index.json':`responses${endpoint}.json`;
  const serialized=JSON.stringify(body,null,2)+'\n';
  const destination=path.join(exportRoot,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,serialized);
  files.push({endpoint:`/api/v1${endpoint}`,file:relative,sha256:crypto.createHash('sha256').update(serialized).digest('hex')});
}
await fs.writeFile(path.join(root,'content/mock-bundle.js'),'/* Generated from the same JSON DTOs as backend-package. */\nwindow.LK_MOCK_BUNDLE = '+JSON.stringify(bundle)+';\n');
await fs.writeFile(path.join(exportRoot,'catalog-import.json'),JSON.stringify({schemaVersion:'1.0',contentVersion:version,courses:allCourses.map(c=>endpoints[`/courses/${c.id}`].data),lessons:allLessons},null,2)+'\n');
// Self-contained files for importing or reading one entire course.
await fs.mkdir(path.join(exportRoot,'courses'),{recursive:true});
function markdownBlock(block){
  switch(block.type){
    case 'heading':return `### ${block.text}`;
    case 'paragraph':return block.text;
    case 'code':return `### ${block.title} (${block.filename})\n\n\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case 'callout':case 'reference':return `### ${block.title}\n\n${block.text}`;
    case 'steps':return `### ${block.title}\n\n${block.items.map((s,i)=>`${i+1}. ${s}`).join('\n')}`;
    case 'checklist':return `### ${block.title}\n\n${block.items.map(s=>`- [ ] ${s}`).join('\n')}`;
    case 'glossary':return `### ${block.title}\n\n${block.items.map(s=>`- **${s.term}**: ${s.definition}`).join('\n')}`;
    default:throw new Error('Unknown block: '+block.type);
  }
}
const courseFiles=[];
const reviewLesson=allLessons.find(l=>l.id==='python-60');
await fs.writeFile(path.join(exportRoot,'examples/submission-review-request.json'),JSON.stringify({lessonId:reviewLesson.id,lessonVersion:reviewLesson.version,exerciseId:reviewLesson.exercise.id,exerciseVersion:reviewLesson.exercise.version,language:reviewLesson.exercise.language,runtimeProfileId:reviewLesson.exercise.runtimeProfileId,files:reviewLesson.exercise.files.map(f=>({path:f.path,code:f.starterCode})),stdin:''},null,2)+'\n');
for(const summary of allCourses){
  const course=endpoints[`/courses/${summary.id}`].data,lessons=allLessons.filter(l=>l.courseId===course.id);
  const jsonFile=`courses/${course.id}.json`,markdownFile=`courses/${course.id}.md`;
  await fs.writeFile(path.join(exportRoot,jsonFile),JSON.stringify({schemaVersion:'1.0',contentVersion:version,course,lessons},null,2)+'\n');
  const text=[`# ${course.subtitle}`,course.description,`${course.lessons} уроков · ${course.hours} часов с практикой · ${course.prerequisites}`,...lessons.map(lesson=>{
    const e=lesson.exercise;
    return [`## Урок ${lesson.position+1}. ${lesson.title}`,`Идентификатор: ${lesson.id} · ${lesson.estimatedMinutes} мин`,...lesson.blocks.map(markdownBlock),`### ${e.title}`,e.prompt,...(e.fixture?[`Исходные данные:\n\n\`\`\`json\n${JSON.stringify(e.fixture.tables,null,2)}\n\`\`\``]:[]),...e.files.map(f=>`Стартовый файл: ${f.path}\n\n\`\`\`${f.language}\n${f.starterCode}\n\`\`\``),...e.publicExamples.map(x=>`Ожидаемый результат:\n\n\`\`\`text\n${x.expectedOutput}\n\`\`\``),'Подсказки:\n\n'+e.hints.map(h=>'- '+h).join('\n'),...lesson.references.map(r=>`[${r.label}](${r.url})`)].join('\n\n');
  })].join('\n\n')+'\n';
  await fs.writeFile(path.join(exportRoot,markdownFile),text);
  courseFiles.push({courseId:course.id,json:jsonFile,markdown:markdownFile});
}
const manifest={package:'logickernel-curriculum',schemaVersion:'1.0',contentVersion:version,courseCount:allCourses.length,lessonCount:allLessons.length,exerciseCount:allLessons.length,editorialStatus:'requires_review_before_publication',contentLanguage:'ru',gradingStatus:'public_exercises_only_hidden_tests_and_runners_not_implemented',courseFiles,files};
await fs.writeFile(path.join(exportRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
vm.runInContext(await fs.readFile(path.join(root,'content/tasks.js'),'utf8'),context);
await fs.writeFile(path.join(exportRoot,'task-import.json'),JSON.stringify({schemaVersion:'1.0',tasks:context.window.LK_TASKS},null,2)+'\n');
console.log(JSON.stringify({courses:allCourses.length,lessons:allLessons.length,exercises:allLessons.length,apiResponses:files.length},null,2));
await import('./build-openapi.mjs');
