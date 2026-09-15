// Only sends source text and renders server responses, never executes source code
window.LKTask = (() => {
  let controller = null;
  let busy = false;

  function dispose() {
    controller?.abort();
    controller = null;
    busy = false;
  }

  function show(result, className = '') {
    const output = document.querySelector('#test-results');
    if (output) {
      output.className = 'test-result ' + className;
      output.textContent = result;
    }
  }

  async function submit(task) {
    const editor = document.querySelector('#code-editor');
    if (!task || !editor || busy) return;
    state.drafts[task.id] = editor.value;
    save();
    if (LKApi.mode === 'mock') {
      show('Проект ещё в разработке, отправка решений появится после подключения бэкенда, черновик остаётся в редакторе');
      return;
    }
    if (!editor.value.trim()) { show('Сначала напишите решение'); return; }
    if (new TextEncoder().encode(editor.value).length > 65536) { show('Размер кода превышает 64 КБ'); return; }

    const body = {
      taskId: task.id, taskVersion: task.version,
      language: task.language, runtimeProfileId: task.runtimeProfileId,
      files: [{path: task.entryFile, code: editor.value}], stdin: ''
    };
    state.taskRequests ??= {};
    const fingerprint = JSON.stringify(body);
    let saved = state.taskRequests[task.id];
    if (saved?.fingerprint !== fingerprint) {
      saved = {fingerprint, idempotencyKey: crypto.randomUUID()};
      state.taskRequests[task.id] = saved;
      save();
    }
    const button = document.querySelector('[data-action="submit-task"]');
    const requestController = new AbortController();
    controller = requestController;
    busy = true;
    button.disabled = true;
    show('Отправляем решение на сервер');
    try {
      let {data} = await LKApi.submitTask(body, {signal: requestController.signal, idempotencyKey: saved.idempotencyKey});
      const started = Date.now();
      while (['queued', 'running'].includes(data.status)) {
        if (Date.now() - started > LK_CONFIG.maxPollDurationMs) {
          show('Ответ ещё не готов, повторная отправка неизменённого решения запросит ту же попытку');
          return;
        }
        show(data.status === 'queued' ? 'Решение в очереди на сервере' : 'Сервер проверяет решение');
        await new Promise((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => {requestController.signal.removeEventListener('abort', onAbort); resolve();}, Math.max(300, Math.min(5000, data.pollAfterMs || LK_CONFIG.pollIntervalMs)));
          requestController.signal.addEventListener('abort', onAbort, {once:true});
        });
        ({data} = await LKApi.getTaskSubmission(data.id, {signal: requestController.signal}));
      }
      if (requestController.signal.aborted) return;
      if (data.taskId !== task.id || data.taskVersion !== task.version) {
        show('Сервер вернул результат для другой версии задачи');
        return;
      }
      const accepted = data.status === 'finished' && data.verdict === 'accepted' && data.isDemo === false;
      show(data.feedback?.summary || (accepted ? 'Сервер принял решение' : 'Сервер завершил обработку решения'), accepted ? 'success' : 'error');
      if (accepted && !state.solved.includes(task.id)) {
        state.solved.push(task.id);
        save();
      }
    } catch (error) {
      if (error.name !== 'AbortError') show(error.message || 'Не удалось связаться с сервером');
    } finally {
      if (controller === requestController) {
        busy = false;
        if (button.isConnected) button.disabled = false;
      }
    }
  }
  return Object.freeze({submit, dispose});
})();
