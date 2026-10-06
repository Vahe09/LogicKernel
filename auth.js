// Account identity is restored from the server. Passwords and session cookies are never stored here.
window.LKAuth = (() => {
  let user = null;
  let ready = false;
  let sessionRequest = null;

  function applySession(data) {
    if (!data || !('user' in data) || typeof data.csrfToken !== 'string' || !data.csrfToken) {
      throw new LKApi.ApiError('INVALID_RESPONSE', 'Сервер вернул неполную сессию.');
    }
    if (data.user !== null && (['id','name','surname','email','bio'].some(key => typeof data.user[key] !== 'string') || !data.user.id || !data.user.name || !data.user.email)) {
      throw new LKApi.ApiError('INVALID_RESPONSE', 'Сервер вернул неполный профиль.');
    }
    const previousUser = user;
    const changed = !ready || JSON.stringify(user) !== JSON.stringify(data.user);
    user = data.user;
    ready = true;
    LKApi.setCSRFToken(data.csrfToken);
    if (changed) window.dispatchEvent(new CustomEvent('lk:auth-changed', {detail: {user, previousUser}}));
  }

  async function refresh() {
    if (LKApi.mode !== 'http') {
      ready = true;
      window.dispatchEvent(new CustomEvent('lk:auth-changed', {detail: {user: null, previousUser: user}}));
      return;
    }
    if (!sessionRequest) {
      sessionRequest = LKApi.getSession().then(({data}) => applySession(data)).finally(() => { sessionRequest = null; });
    }
    return sessionRequest;
  }

  async function init() {
    try { await refresh(); }
    catch (error) {
      ready = true;
      document.querySelector('.auth-actions')?.setAttribute('data-session-error', 'true');
      console.warn('Не удалось восстановить сессию:', error.code);
    }
  }

  function open(mode = 'login', values = {}) {
    const registration = mode === 'register';
    openModal(registration ? 'Создать аккаунт' : 'Войти в LogicKernel', `
      <p class="auth-intro">${registration ? 'Сохраните свой профиль и отправляйте решения от своего имени.' : 'Продолжите обучение в своём аккаунте.'}</p>
      <form id="auth-form" data-mode="${mode}">
        <div class="form-grid">
          ${registration ? `<label class="field">Имя<input name="name" required maxlength="30" autocomplete="given-name" value="${escapeHTML(values.name || '')}"></label>
          <label class="field">Фамилия<input name="surname" required maxlength="40" autocomplete="family-name" value="${escapeHTML(values.surname || '')}"></label>` : ''}
          <label class="field full">Электронная почта<input type="email" name="email" required maxlength="254" autocomplete="username" value="${escapeHTML(values.email || '')}"></label>
          <label class="field full">Пароль<div class="auth-password"><input type="password" name="password" required ${registration ? 'minlength="8"' : ''} maxlength="128" autocomplete="${registration ? 'new-password' : 'current-password'}"><button type="button" class="auth-password-toggle" data-action="auth-password" aria-label="Показать пароль" aria-pressed="false">Показать</button></div>${registration ? '<small>От 8 до 128 символов.</small>' : ''}</label>
          ${registration ? '<label class="field full">Повторите пароль<input type="password" name="passwordConfirm" required minlength="8" maxlength="128" autocomplete="new-password"></label>' : ''}
        </div>
        <p class="auth-error" id="auth-error" role="alert" aria-live="polite" hidden></p>
        <div class="form-actions"><button type="submit" class="button primary auth-submit">${registration ? 'Создать аккаунт' : 'Войти'}</button></div>
      </form>
      <p class="auth-switch">${registration ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <button type="button" data-action="auth-${registration ? 'login' : 'register'}">${registration ? 'Войти' : 'Зарегистрироваться'}</button></p>
    `);
    const controller = new AbortController();
    modalCleanup = () => controller.abort();
    document.querySelector('#auth-form').addEventListener('submit', event => submit(event, controller));
    requestAnimationFrame(() => document.querySelector('#auth-form input')?.focus());
  }

  async function submit(event, controller) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.busy) return;
    const fields = new FormData(form);
    const registration = form.dataset.mode === 'register';
    const errorBox = form.querySelector('#auth-error');
    errorBox.hidden = true;
    const password = String(fields.get('password'));
    if (registration && password !== fields.get('passwordConfirm')) {
      errorBox.textContent = 'Пароли не совпадают.';
      errorBox.hidden = false;
      form.elements.passwordConfirm.focus();
      return;
    }
    const body = {email: String(fields.get('email')).trim(), password};
    if (registration) {
      body.name = String(fields.get('name')).trim();
      body.surname = String(fields.get('surname')).trim();
      if (!body.name || !body.surname) {
        errorBox.textContent = 'Введите имя и фамилию.';
        errorBox.hidden = false;
        return;
      }
    }
    const button = form.querySelector('[type="submit"]');
    const originalLabel = button.textContent;
    form.dataset.busy = 'true';
    button.textContent = registration ? 'Создаём аккаунт…' : 'Входим…';
    for (const control of form.elements) control.disabled = true;
    try {
      await refresh();
      if (controller.signal.aborted) return;
      const {data} = await (registration ? LKApi.register : LKApi.login)(body, {signal: controller.signal});
      if (controller.signal.aborted) return;
      applySession(data);
      closeModal();
      toast(registration ? 'Аккаунт создан. Вы вошли.' : 'Вы вошли в аккаунт.');
    } catch (error) {
      if (!controller.signal.aborted && form.isConnected) {
        errorBox.textContent = error.message || 'Не удалось связаться с сервером.';
        errorBox.hidden = false;
      }
    } finally {
      if (form.isConnected) {
        delete form.dataset.busy;
        for (const control of form.elements) control.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  async function logout(button) {
    if (button) button.disabled = true;
    try {
      await refresh();
      const {data} = await LKApi.logout();
      applySession(data);
      closeModal();
      toast('Вы вышли из аккаунта.');
    } catch (error) {
      if (error.status === 401) { await refresh().catch(() => {}); closeModal(); }
      toast(error.message || 'Не удалось выйти. Повторите попытку.');
    } finally { if (button?.isConnected) button.disabled = false; }
  }

  async function updateProfile(body) {
    const {data} = await LKApi.updateProfile(body);
    applySession(data);
    return user;
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'auth-login' || target.dataset.action === 'auth-register') {
      if (document.querySelector('#auth-form')?.dataset.busy) return;
      const current = document.querySelector('#auth-form');
      const values = current ? Object.fromEntries(new FormData(current)) : {};
      open(target.dataset.action === 'auth-register' ? 'register' : 'login', values);
    }
    if (target.dataset.action === 'auth-logout') logout(target);
    if (target.dataset.action === 'auth-password') {
      const input = target.parentElement.querySelector('input');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      target.textContent = visible ? 'Скрыть' : 'Показать';
      target.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
      target.setAttribute('aria-pressed', String(visible));
    }
  });
  window.addEventListener('lk:session-expired', () => refresh().catch(() => {}));
  return Object.freeze({get user() { return user; }, get ready() { return ready; }, init, refresh, open, updateProfile});
})();
