# LogicKernel: как написать бэкенд для этого фронтенда

**Команда пишет свой бэкенд сама. Весь Python-код ниже — учебный пример и полный ориентир для вашей реализации.** Разбирайте его по функциям: что приходит, что функция делает и что возвращает. Полный пример одним файлом: [examples/python_backend.py](backend-package/examples/python_backend.py).

На фронтенде уже добавлены регистрация, вход, выход, восстановление входа после обновления страницы и сохранение профиля через API. Чтобы они работали, ваш сервер должен реализовать адреса из этой инструкции.

Сначала сделайте шаги 1–4: сайт, база и материалы. Затем 5–8: сессии, регистрация, вход и профиль. Затем 9–12: сохранение решений и история. Каждый этап даёт видимый результат в браузере.


## 1. Подготовьте папки и файлы для сервера

Откройте терминал в `LogicKernel`, где лежит `index.html`. Создайте `public/` для файлов браузера и `backend/` для своего Python-кода:

```bash
mkdir -p public/content public/assets backend
cp index.html styles.css config.js api.js auth.js app.js lesson-view.js task-submit.js public/
cp content/tasks.js public/content/
cp assets/favicon.svg public/assets/
```

Получится:

```text
LogicKernel/
  public/                     ← сервер раздаёт браузеру
    index.html
    styles.css
    config.js
    api.js
    auth.js
    app.js
    lesson-view.js
    task-submit.js
    content/tasks.js
    assets/favicon.svg
  backend/                    ← здесь вы пишете свой app.py
  backend-package/            ← готовые материалы и учебные примеры для API
  .local-backend/              ← здесь пример хранит БД; создаётся при запуске
```

В **`public/config.js`** запишите:

```javascript
window.LK_CONFIG = Object.freeze({
  mode: 'http', baseUrl: '/api/v1', mockLatencyMs: 100,
  requestTimeoutMs: 10000, pollIntervalMs: 800, maxPollDurationMs: 30000
});
```

На сервере настройте два направления:

```text
http://127.0.0.1:8000/         → public/index.html
http://127.0.0.1:8000/app.js   → public/app.js, так же для остальных файлов сайта
http://127.0.0.1:8000/api/v1/… → функции вашего Python-приложения
```

Сайт и API должны работать на одном адресе. На опубликованном сайте меняется домен, а `/api/v1` остаётся. Сборка фронтенда не нужна.

| Папка | Практическое действие |
| --- | --- |
| `public/` | Только файлы из списка выше. Их получает браузер. |
| `backend/` | Создаёте сами и пишете здесь свой бэкенд. |
| `backend-package/responses/` | Возвращаете готовый JSON курсов и уроков из этой папки. |
| `backend-package/examples/` | Смотрите полные примеры сообщений и учебный Python-код. |
| `backend-package/schemas/` | Сверяете точные поля запросов и ответов. |
| `backend-package/courses/` | Берёте один курс целиком, если нужен отдельный импорт или чтение его материалов. |
| `backend-package/fixtures/` | Учебные SQL-данные; для выдачи каталога и входа не нужны. |
| `content/`, `assets/` | Исходные материалы и ресурсы. В `public/` копируете только указанное выше. |
| `tools/`, `verification/`, `.git/`, `.venv/`, `.local-backend/` | Оставляете вне публичной папки сайта. |

**ZIP — архив `backend-package/` для передачи участникам команды.** В нём материалы, образцы API и учебный пример Python. Для работы со страницами нужен весь `LogicKernel`: фронтенд в ZIP не входит. Сама папка `backend-package/` содержит данные для вашего сервера; браузер получает их через отдельные ответы API.

Установите зависимости для работы с примерами:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend-package/examples/requirements.txt
```

Нужен Python 3.10 или новее. В примерах используем FastAPI, SQLite и Argon2 для паролей. Вы можете распределить функции по нескольким файлам; здесь они собраны рядом, чтобы было видно весь обмен.

Если на Ubuntu/Debian создание окружения сообщает об отсутствии `venv`, установите системный пакет `python3-venv`, затем повторите команду создания окружения. После установки зависимостей Python запускаете через `.venv/bin/python`; активация окружения отдельной командой не требуется.

## 2. Напишите основу приложения и общий формат ответов

Создайте свой `backend/app.py`. Начните с импортов и путей. **Этот блок — пример для вашего файла `backend/app.py`:**

Учебные Python-блоки шагов 2–14 составляют одно приложение: функции и классы добавляются в этот файл по порядку. В своём коде реализуйте те же входы и ответы; строка `app.mount(...)` всегда должна оставаться последней.


```python
import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
```

```python
ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "backend-package"
PUBLIC = ROOT / "public"
DATA_DIR = Path(os.environ.get("LK_DATA_DIR", str(ROOT / ".local-backend")))
DATABASE = DATA_DIR / "platform.sqlite3"
COOKIE_NAME = "lk_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
PASSWORDS = PasswordHasher()
DUMMY_PASSWORD_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))

manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
materials = {
    item["endpoint"]: json.loads((PACKAGE / item["file"]).read_text(encoding="utf-8"))
    for item in manifest["files"]
}
tasks = {
    task["id"]: task
    for task in json.loads((PACKAGE / "task-import.json").read_text(encoding="utf-8"))["tasks"]
}
```

Теперь в `materials` есть соответствие адреса API готовому ответу. Например, `materials["/api/v1/lessons/python-01"]` содержит полный JSON первого урока Python.

Создайте приложение. `lifespan()` вызывает `init_database()` из следующего шага перед началом приёма запросов:


```python
@asynccontextmanager
async def lifespan(app):
    init_database()
    yield
```

```python
app = FastAPI(lifespan=lifespan)
```

Следом напишите общий помощник для успешных ответов и обработчики ошибок:


```python
def response(data, status=200):
    return JSONResponse(
        status_code=status,
        content={"data": data, "meta": {"schemaVersion": "1.0"}},
        headers={"Cache-Control": "no-store"},
    )


class APIError(Exception):
    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


@app.exception_handler(APIError)
async def api_error(request, error):
    return JSONResponse(
        status_code=error.status,
        content={"error": {"code": error.code, "message": error.message, "details": error.details}},
        headers={"Cache-Control": "no-store"},
    )


@app.exception_handler(RequestValidationError)
async def invalid_body(request, error):
    return await api_error(request, APIError(400, "INVALID_REQUEST", "Проверьте заполненные поля и формат запроса."))
```

Когда функция возвращает пользователя, историю или попытку, вызывайте `response(data)`. Фронтенд получит `{"data": ..., "meta": {"schemaVersion": "1.0"}}`. Когда действие невозможно, используйте, например, `raise APIError(401, "UNAUTHENTICATED", "Войдите в аккаунт.")`. Сообщение окажется на странице.

В функциях ниже `request: Request` даёт доступ к cookie и заголовкам. Аргумент вроде `body: RegisterInput` заполняется из JSON запроса; у него можно прочитать `body.email`, `body.password` и другие объявленные поля.

## 3. Создайте хранение пользователей, сессий и попыток

Напишите `database()`: открыть SQLite, выполнить действия, сохранить изменения и закрыть соединение. Дальше все функции обращаются к БД через `with database() as db:`.


```python
@contextmanager
def database():
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                surname TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(id),
                csrf_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                request_json TEXT NOT NULL,
                status TEXT NOT NULL,
                verdict TEXT,
                feedback_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, kind, idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS attempts_history
                ON attempts(user_id, kind, target_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS auth_limits (
                client TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                reset_at INTEGER NOT NULL
            );
        """)
```

У каждой таблицы есть конкретная работа:

- `users`: одна строка на аккаунт; почта, хеш пароля, имя, фамилия, описание.
- `sessions`: какая случайная cookie относится к какому пользователю и до какого времени действует. `user_id = NULL` означает гостя.
- `attempts`: кому принадлежит отправленное решение, полный текст отправки и текущее состояние попытки.
- `auth_limits`: количество обращений ко входу и регистрации за минуту; используется в шаге 6.

**Что сделать сначала:** написать эти две функции и получить файл `.local-backend/platform.sqlite3` при запуске. Пользователи и попытки должны сохраняться после остановки сервера.

## 4. Верните каталог, курс и урок

Скопируйте `backend-package/` на сервер рядом с `public/` и `backend/`, как в шаге 1. Если получили ZIP, сначала распакуйте его: у вашего Python-приложения должна быть доступна папка `backend-package/responses/`.

**Что именно брать из пакета и выдавать фронтенду:**

| Что открывает человек | Запрос фронтенда | Какой файл читает бэкенд |
| --- | --- | --- |
| Каталог курсов | `GET /api/v1/courses` | `backend-package/responses/courses/index.json` |
| Программу курса Python | `GET /api/v1/courses/python` | `backend-package/responses/courses/python.json` |
| Первый урок Python | `GET /api/v1/lessons/python-01` | `backend-package/responses/lessons/python-01.json` |

Для других курсов и уроков меняется ID: например, `/api/v1/courses/go` получает `responses/courses/go.json`, а `/api/v1/lessons/go-01` — `responses/lessons/go-01.json`.

Адрес страницы `/#/lesson/python/python-01` переключает экран внутри браузера. Чтобы получить данные этого экрана, фронтенд отдельно делает `GET /api/v1/lessons/python-01` — именно этот запрос обрабатывает ваша Python-функция.

Как это делает учебный код из шага 2:

1. При запуске Python читает `backend-package/manifest.json`. В его `files` для каждого материала записаны `endpoint` — адрес запроса и `file` — путь к JSON внутри пакета.
2. `read_text(encoding="utf-8")` читает текст нужного файла, а `json.loads(...)` превращает его в Python-словарь. Все ответы складываются в `materials`: ключ — адрес API, значение — содержимое JSON.
3. Когда приходит запрос, ваша функция берёт ответ из `materials` и возвращает его. FastAPI отправляет его браузеру как JSON с HTTP 200 и `Content-Type: application/json`.
4. Фронтенд читает `data` из ответа и показывает каталог, программу курса или урок. При последующих запросах файл заново читать не требуется; после обновления материалов перезапустите этот пример сервера.

Здесь работа с БД пока не нужна. **Функции ниже — учебный ориентир для вашей реализации:**


```python
def material(url):
    if url not in materials:
        raise APIError(404, "NOT_FOUND", "Материал не найден.")
    return materials[url]


@app.get("/api/v1/courses")
def list_courses():
    return material("/api/v1/courses")


@app.get("/api/v1/courses/{course_id}")
def get_course(course_id: str):
    return material(f"/api/v1/courses/{course_id}")


@app.get("/api/v1/lessons/{lesson_id}")
def get_lesson(lesson_id: str):
    return material(f"/api/v1/lessons/{lesson_id}")
```

Поток на конкретном примере:

1. Человек открыл сайт → фронтенд вызвал `GET /api/v1/courses` → `list_courses()` вернула каталог.
2. Человек открыл Python → `GET /api/v1/courses/python` → `get_course("python")` вернула программу курса.
3. Человек открыл первый урок → `GET /api/v1/lessons/python-01` → `get_lesson("python-01")` вернула текст и данные редактора.

Готовые ответы уже содержат `data` и `meta`. Возвращайте их целиком, как выше. У каталога `data` — список курсов; у курса и урока — объект. Изменение названий или вложенности полей потребует изменения фронтенда.

Отдельные задачи из раздела «Задачи» фронтенд показывает из `public/content/tasks.js`. Бэкенд читает их серверные описания из `backend-package/task-import.json`, чтобы сверять поступающие отправки в шаге 10. Их тексты не выдаются через три GET выше.

Если позже переносите материалы в свою БД, импортируйте `courses` и `lessons` из `backend-package/catalog-import.json`, а отдельные задачи — из `backend-package/task-import.json`. Ответы собирайте в той же форме, что в `responses/`.

**Запустите уже этот этап:** в самый конец `backend/app.py` добавьте строку `app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="frontend")`. Из корня проекта выполните:

```bash
.venv/bin/python -m uvicorn app:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Откройте `http://127.0.0.1:8000/#/courses`, затем Python и первый урок. В Network должны появиться три успешных ответа из таблицы выше. Запрос сессии на этом этапе ещё может возвращать 404 — его функцию добавите в шаге 5. Все новые функции API добавляйте **выше** последней строки `app.mount(...)`.

**Результат этапа:** каталог, программа курса и урок открываются с вашего сервера. Далее подключаете вход.

## 5. Научите сервер узнавать пользователя по сессии

При каждой загрузке страницы фронтенд вызывает **`GET /api/v1/auth/session`**. Сервер возвращает два значения: `user` и `csrfToken`.

Гость получает:

```json
{
  "data": {"user": null, "csrfToken": "csrf_example_guest_001"},
  "meta": {"schemaVersion": "1.0"}
}
```

В заголовке `Set-Cookie` сервер также устанавливает `lk_session`. Браузер сохраняет её и автоматически прикладывает к следующим запросам на тот же сайт. В Python вы читаете её через `request.cookies.get("lk_session")`.

Напишите небольшие помощники для времени, поиска сессии и подготовки публичного пользователя:


```python
def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def public_user(user):
    return {key: user[key] for key in ("id", "name", "surname", "email", "bio")}


def load_session(request):
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 256:
        return None
    with database() as db:
        return db.execute(
            "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?",
            (hash_token(token), int(time.time())),
        ).fetchone()


def session_data(session):
    with database() as db:
        user = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    return {"user": public_user(user) if user else None, "csrfToken": session["csrf_token"]}
```

`load_session(request)` берёт cookie, ищет её хеш в таблице `sessions` и возвращает действующую строку. `session_data(session)` находит пользователя этой сессии. `public_user(user)` выбирает только данные профиля для браузера.

Теперь напишите `new_session()`. Она создаёт новые случайные значения, записывает их связь в БД и устанавливает cookie в ответе:


```python
def new_session(request, user_id=None, status=200):
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    expires = int(time.time()) + SESSION_SECONDS
    with database() as db:
        old_token = request.cookies.get(COOKIE_NAME)
        if old_token:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(old_token),))
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
            (hash_token(token), user_id, csrf, expires),
        )
        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    result = response({"user": public_user(user) if user else None, "csrfToken": csrf}, status)
    result.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True,
        secure=request.url.scheme == "https" or os.environ.get("LK_COOKIE_SECURE") == "1",
        samesite="lax", path="/",
    )
    return result


@app.get("/api/v1/auth/session")
def get_auth_session(request: Request):
    session = load_session(request)
    return response(session_data(session)) if session else new_session(request)
```

После входа ответ имеет такую форму:

```json
{
  "data": {
    "user": {
      "id": "u_001", "name": "Анна", "surname": "Иванова",
      "email": "anna@example.com", "bio": ""
    },
    "csrfToken": "csrf_example_user_001"
  },
  "meta": {"schemaVersion": "1.0"}
}
```

**Что фронтенд делает сам:** показывает имя из `user`, скрывает кнопки входа, запоминает `csrfToken` в памяти и передаёт его в заголовке `X-CSRF-Token` у POST и PATCH. Пароль и cookie сессии в localStorage не записываются. После обновления страницы снова приходит `GET /api/v1/auth/session`.

Для POST и PATCH напишите `require_csrf()`. Для действий вошедшего пользователя напишите `require_user()`:


```python
def require_csrf(request):
    session = load_session(request)
    supplied = request.headers.get("X-CSRF-Token", "")
    if not session or not secrets.compare_digest(supplied.encode("utf-8"), session["csrf_token"].encode("utf-8")):
        raise APIError(403, "INVALID_CSRF_TOKEN", "Обновите страницу и повторите действие.")
    return session


def require_user(request):
    session = load_session(request)
    if not session or not session["user_id"]:
        raise APIError(401, "UNAUTHENTICATED", "Войдите в аккаунт.")
    with database() as db:
        user = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not user:
        raise APIError(401, "UNAUTHENTICATED", "Войдите в аккаунт.")
    return user
```

`require_user(request)` возвращает строку пользователя из БД. Именно её `id` используйте при сохранении профиля и попыток. `userId` в теле запроса фронтенд не присылает.

Поток входа выглядит так:

```mermaid
sequenceDiagram
    participant F as Фронтенд
    participant B as Ваш Python-бэкенд
    participant D as SQLite
    F->>B: GET /api/v1/auth/session
    B->>D: Найти сессию из cookie или создать гостевую
    B-->>F: user и csrfToken; Set-Cookie при создании
    F->>B: POST /api/v1/auth/login: email, password, cookie, X-CSRF-Token
    B->>D: Найти пользователя по email
    B->>B: Сверить пароль с сохранённым хешем
    B->>D: Заменить сессию на сессию пользователя
    B-->>F: user, новый csrfToken и новая cookie
```

**Результат этапа:** при перезагрузке браузер узнаёт своё состояние, а защищённые функции могут получить текущего пользователя.

## 6. Напишите регистрацию

Человек заполнил форму и нажал «Создать аккаунт». Фронтенд сначала получает сессию из шага 5, затем отправляет **`POST /api/v1/auth/register`**:

```json
{"name":"Анна","surname":"Иванова","email":"anna@example.com","password":"ExamplePassword42!"}
```

Повтор пароля сравнивается в форме и в запрос не входит. Имя и фамилия обязательны, пароль при регистрации — от 8 до 128 символов.

Опишите входные данные через `Input` и `RegisterInput`. В последующих шагах остальные классы тоже наследуются от `Input`:


```python
class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("name", "surname", check_fields=False)
    @classmethod
    def trim_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Введите имя и фамилию")
        return value


class RegisterInput(Input):
    name: str = Field(min_length=1, max_length=30)
    surname: str = Field(min_length=1, max_length=40)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
```

Затем напишите `limit_auth_requests()` и `register()`:


```python
def limit_auth_requests(request):
    client = request.client.host if request.client else "unknown"
    now = int(time.time())
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM auth_limits WHERE client = ?", (client,)).fetchone()
        if row and row["reset_at"] > now and row["count"] >= 10:
            raise APIError(429, "RATE_LIMITED", "Слишком много попыток входа. Подождите минуту.")
        if not row or row["reset_at"] <= now:
            db.execute("INSERT OR REPLACE INTO auth_limits VALUES (?, ?, ?)", (client, 1, now + 60))
        else:
            db.execute("UPDATE auth_limits SET count = count + 1 WHERE client = ?", (client,))


@app.post("/api/v1/auth/register")
def register(request: Request, body: RegisterInput):
    require_csrf(request)
    limit_auth_requests(request)
    user_id = uuid.uuid4().hex
    password_hash = PASSWORDS.hash(body.password)
    try:
        with database() as db:
            db.execute(
                "INSERT INTO users(id, email, password_hash, name, surname, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, str(body.email).casefold(), password_hash, body.name, body.surname, timestamp()),
            )
    except sqlite3.IntegrityError:
        raise APIError(409, "EMAIL_ALREADY_EXISTS", "Эта почта уже зарегистрирована. Войдите в аккаунт.")
    return new_session(request, user_id, status=201)
```

Обсудите реализацию по этим действиям:

1. Проверить сессию и `X-CSRF-Token` через `require_csrf()`.
2. Привести почту к одному виду: `str(body.email).casefold()`.
3. Получить хеш: `PASSWORDS.hash(body.password)`.
4. Создать ID и добавить строку в `users`. В БД сохраняется `password_hash`.
5. Если почта занята — вернуть HTTP 409, `EMAIL_ALREADY_EXISTS`.
6. Вызвать `new_session(request, user_id, status=201)` и вернуть пользователя в форме из шага 5.

**Результат этапа:** после регистрации человек сразу вошёл; в верхней панели показано его имя. Обновление страницы сохраняет вход.

## 7. Напишите вход по почте и паролю

Форма вызывает **`POST /api/v1/auth/login`**:

```json
{"email":"anna@example.com","password":"ExamplePassword42!"}
```

Ваши функции:


```python
class LoginInput(Input):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/v1/auth/login")
def login(request: Request, body: LoginInput):
    require_csrf(request)
    limit_auth_requests(request)
    with database() as db:
        user = db.execute("SELECT * FROM users WHERE email = ?", (str(body.email).casefold(),)).fetchone()
    try:
        PASSWORDS.verify(user["password_hash"] if user else DUMMY_PASSWORD_HASH, body.password)
    except (VerificationError, InvalidHashError):
        raise APIError(401, "INVALID_CREDENTIALS", "Неверная почта или пароль.")
    if not user:
        raise APIError(401, "INVALID_CREDENTIALS", "Неверная почта или пароль.")
    if PASSWORDS.check_needs_rehash(user["password_hash"]):
        with database() as db:
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (PASSWORDS.hash(body.password), user["id"]))
    return new_session(request, user["id"])
```

Здесь `login()` получает запись из `users` по почте, вызывает `PASSWORDS.verify(password_hash, body.password)`, затем выдаёт новую сессию. Если почта или пароль неверны, верните HTTP 401 с `error.code: "INVALID_CREDENTIALS"` и сообщением «Неверная почта или пароль».

`?` в SQL-запросе заполняется значениями из второго аргумента `db.execute(...)`. Например, `(str(body.email).casefold(),)` передаёт введённую почту. Во всех примерах пользовательские данные передаются так.

**Результат этапа:** после выхода пользователь может войти снова; неправильный пароль показывается ошибкой внутри формы.

## 8. Напишите выход и сохранение профиля

### Выход

Кнопка «Выйти из аккаунта» сначала обновляет сессию через GET, затем вызывает **`POST /api/v1/auth/logout`**, тело `{}`. Она отправляет cookie и `X-CSRF-Token`.


```python
@app.post("/api/v1/auth/logout")
def logout(request: Request):
    require_csrf(request)
    return new_session(request)
```

`new_session(request)` удаляет прежнюю сессию и создаёт гостевую. Верните HTTP 200, `data.user: null` и новый `csrfToken`. Фронтенд снова покажет «Войти» и «Регистрация». Возвращайте JSON и при выходе: фронтенд читает ответ.

### Профиль

В настройках кнопка «Сохранить изменения» вызывает **`PATCH /api/v1/me`**:

```json
{"name":"Анна","surname":"Иванова","bio":"Начала изучать Python"}
```

Почта в этой форме доступна для чтения и используется для входа. Для сохранения имени, фамилии и описания напишите:


```python
class ProfileInput(Input):
    name: str = Field(min_length=1, max_length=30)
    surname: str = Field(min_length=1, max_length=40)
    bio: str = Field(max_length=300)


@app.patch("/api/v1/me")
def update_profile(request: Request, body: ProfileInput):
    user = require_user(request)
    session = require_csrf(request)
    with database() as db:
        db.execute("UPDATE users SET name = ?, surname = ?, bio = ? WHERE id = ?", (body.name, body.surname, body.bio, user["id"]))
    return response(session_data(session))
```

Функция получает пользователя из cookie, обновляет только его строку в `users` и возвращает обновлённую сессию. Фронтенд берёт новый профиль из ответа. После перезагрузки он снова прочитается из БД.

**Результат этапа:** регистрация → выход → вход → изменение профиля → обновление страницы работают с одним настоящим аккаунтом на вашем сервере.

## 9. Примите данные отправленного решения

Для первой отправки сначала войдите в аккаунт, затем напишите решение и нажмите «Отправить на проверку». Фронтенд отправит **`POST /api/v1/submissions`**:

Если нажать отправку гостем, откроется форма входа. Вход сам по себе решение не отправляет: после входа проверьте текст в редакторе своего аккаунта и снова нажмите отправку. Черновики гостя и аккаунта хранятся отдельно.

```json
{
  "lessonId": "python-01", "lessonVersion": 1,
  "exerciseId": "python-01-practice", "exerciseVersion": 1,
  "language": "python", "runtimeProfileId": "python-intro-v1",
  "files": [{"path": "main.py", "code": "print('Привет, LogicKernel!')\nprint('Это моя первая программа')\n"}],
  "stdin": ""
}
```

Для отдельной задачи из раздела «Задачи» придёт **`POST /api/v1/task-submissions`**:

```json
{
  "taskId": "reverse", "taskVersion": 1,
  "language": "javascript", "runtimeProfileId": "javascript-functions-v1",
  "files": [{"path": "solution.js", "code": "function reverseString(str) {}"}],
  "stdin": ""
}
```

У обоих запросов есть `Content-Type: application/json`, cookie сессии, `X-CSRF-Token` и **`Idempotency-Key`**. Последний фронтенд создаёт при отправке; после потери ответа повторяет тот же ключ для того же содержимого.

Опишите тело запросов:


```python
class SourceFile(Input):
    path: str = Field(min_length=1, max_length=512)
    code: str = Field(max_length=65536)


class SubmissionInput(Input):
    lessonId: str = Field(min_length=1)
    lessonVersion: int = Field(ge=1, strict=True)
    exerciseId: str = Field(min_length=1)
    exerciseVersion: int = Field(ge=1, strict=True)
    language: str
    runtimeProfileId: str
    files: list[SourceFile] = Field(min_length=1, max_length=10)
    stdin: str = Field(max_length=8192)


class TaskSubmissionInput(Input):
    taskId: str = Field(min_length=1)
    taskVersion: int = Field(ge=1, strict=True)
    language: str
    runtimeProfileId: str
    files: list[SourceFile] = Field(min_length=1, max_length=10)
    stdin: str = Field(max_length=8192)
```

Что сохраняете из тела:

| Данные | Действие бэкенда |
| --- | --- |
| ID урока, упражнения или задачи | Найти соответствующее задание на сервере. |
| Версии | Сверить с серверными материалами и сохранить вместе с попыткой. |
| Язык и профиль | Сверить с выбранным заданием и сохранить. |
| `files` | Сохранить все `path` и `code` на момент отправки. |
| `stdin` | Сохранить строку, включая пустую. |

У некоторых уроков несколько файлов. Например, `python-60` содержит `main.py`, `component.py` и `design.md`. Все тексты приходят в одном `files`; сохраняйте также Markdown.

## 10. Сверьте запрос с заданием на сервере

Напишите `validate_submission(body, kind)`. На входе уже разобранное тело и `kind`: `lesson` для урока или `task` для отдельной задачи.


```python
def validate_submission(body, kind):
    if kind == "lesson":
        lesson = material(f"/api/v1/lessons/{body['lessonId']}")["data"]
        exercise = lesson["exercise"]
        if body["lessonVersion"] != lesson["version"] or body["exerciseVersion"] != exercise["version"]:
            raise APIError(409, "CONTENT_VERSION_MISMATCH", "Задание обновилось. Обновите страницу.")
        if body["exerciseId"] != exercise["id"]:
            raise APIError(400, "INVALID_REQUEST", "Упражнение не относится к этому уроку.")
        allowed = [file["path"] for file in exercise["files"]]
        constraints = exercise["constraints"]
    else:
        exercise = tasks.get(body["taskId"])
        if not exercise:
            raise APIError(404, "NOT_FOUND", "Задача не найдена.")
        if body["taskVersion"] != exercise["version"]:
            raise APIError(409, "CONTENT_VERSION_MISMATCH", "Задача обновилась. Обновите страницу.")
        allowed = [exercise["entryFile"]]
        constraints = {"maxCodeBytes": 65536, "maxStdinBytes": 8192}
    if body["language"] != exercise["language"] or body["runtimeProfileId"] != exercise["runtimeProfileId"]:
        raise APIError(400, "INVALID_REQUEST", "Язык или профиль не совпадает с заданием.")
    paths = [file["path"] for file in body["files"]]
    if sorted(paths) != sorted(allowed):
        raise APIError(400, "INVALID_REQUEST", "Передайте все файлы задания, без повторов и посторонних имён.")
    code_bytes = sum(len(file["code"].encode("utf-8")) for file in body["files"])
    if code_bytes > constraints["maxCodeBytes"] or len(body["stdin"].encode("utf-8")) > constraints["maxStdinBytes"]:
        raise APIError(413, "PAYLOAD_TOO_LARGE", "Превышен размер кода или входных данных.")
```

Практически здесь нужны четыре сравнения: правильные ID и версии; правильные язык и профиль; точный набор имён файлов; допустимый размер текста в байтах UTF-8. `files[].path` берётся из шаблона задания. Для урока размеры берутся из `lesson["exercise"]["constraints"]`, сейчас это 65536 байт кода и 8192 байта ввода.

**Результат этапа:** сервер принимает ожидаемый формат, а ошибочный запрос возвращает понятное сообщение в редактор.

## 11. Сохраните одну попытку и верните её ID

Сначала напишите `attempt_data(row)`: из строки БД она собирает объект, который ждёт фронтенд. Затем `create_attempt()`: создаёт запись или возвращает уже созданную.


```python
def attempt_data(row):
    body = json.loads(row["request_json"])
    return {
        **body, "id": row["id"], "status": row["status"], "verdict": row["verdict"],
        "feedback": json.loads(row["feedback_json"]) if row["feedback_json"] else None,
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "isDemo": False, "pollAfterMs": 800,
    }


def create_attempt(request, body, kind):
    user = require_user(request)
    require_csrf(request)
    key = request.headers.get("Idempotency-Key", "")
    if not key or len(key) > 128:
        raise APIError(400, "INVALID_REQUEST", "Нужен Idempotency-Key длиной до 128 символов.")
    payload = body.model_dump(mode="json")
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute(
            "SELECT * FROM attempts WHERE user_id = ? AND kind = ? AND idempotency_key = ?",
            (user["id"], kind, key),
        ).fetchone()
        if old:
            if old["request_json"] != serialized:
                raise APIError(409, "IDEMPOTENCY_CONFLICT", "Ключ уже использован для другого решения.")
            return response(attempt_data(old), status=202)
        validate_submission(payload, kind)
        attempt_id = uuid.uuid4().hex
        created = timestamp()
        target = payload["lessonId"] if kind == "lesson" else payload["taskId"]
        db.execute(
            "INSERT INTO attempts(id, user_id, kind, target_id, idempotency_key, request_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (attempt_id, user["id"], kind, target, key, serialized, "queued", created, created),
        )
        row = db.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
    return response(attempt_data(row), status=202)


@app.post("/api/v1/submissions")
def submit_lesson(request: Request, body: SubmissionInput):
    return create_attempt(request, body, "lesson")


@app.post("/api/v1/task-submissions")
def submit_task(request: Request, body: TaskSubmissionInput):
    return create_attempt(request, body, "task")
```

Что обсудить и написать в `create_attempt()`:

1. Получить пользователя через `require_user()` и проверить CSRF-токен.
2. Прочитать `request.headers.get("Idempotency-Key")`.
3. Получить обычный словарь из входной модели: `body.model_dump(mode="json")`.
4. Найти попытку этого пользователя с тем же `kind` и ключом. Сравнить сохранённое тело. При совпадении вернуть прежний ID; при отличии — `409 IDEMPOTENCY_CONFLICT`.
5. Для новой отправки вызвать `validate_submission()`.
6. Создать ID, сохранить полное тело в `request_json`, записать `status = "queued"` и время. Уникальное ограничение и транзакция защищают от двух одинаковых одновременных POST.
7. После сохранения вернуть HTTP 202 и объект попытки через `attempt_data()`.

**Результат этапа:** нажатие кнопки создаёт строку в БД и показывает браузеру ID попытки. Код именно этой отправки остаётся сохранённым, даже если ученик дальше меняет редактор.

## 12. Отдайте попытку по ID и историю пользователя

После POST браузер получает `data.id`. Дальше он вызывает **`GET /api/v1/submissions/<этот-id>`**. Для отдельной задачи — **`GET /api/v1/task-submissions/<этот-id>`**.


```python
def find_attempt(request, attempt_id, kind):
    user = require_user(request)
    with database() as db:
        row = db.execute("SELECT * FROM attempts WHERE id = ? AND user_id = ? AND kind = ?", (attempt_id, user["id"], kind)).fetchone()
    if not row:
        raise APIError(404, "NOT_FOUND", "Попытка не найдена.")
    return response(attempt_data(row))


@app.get("/api/v1/submissions/{attempt_id}")
def get_submission(request: Request, attempt_id: str):
    return find_attempt(request, attempt_id, "lesson")


@app.get("/api/v1/task-submissions/{attempt_id}")
def get_task_submission(request: Request, attempt_id: str):
    return find_attempt(request, attempt_id, "task")
```

Главная строка здесь — поиск по **ID попытки + ID вошедшего пользователя + виду попытки**. Если запись не найдена, верните 404. При чтении пользователь не передаёт свой ID: вы уже получили его через сессию.

При открытии урока вошедшим пользователем также приходит **`GET /api/v1/submissions?lessonId=python-01`**. Напишите историю:


```python
@app.get("/api/v1/submissions")
def list_submissions(request: Request, lessonId: str):
    user = require_user(request)
    material(f"/api/v1/lessons/{lessonId}")
    with database() as db:
        rows = db.execute(
            "SELECT * FROM attempts WHERE user_id = ? AND kind = 'lesson' AND target_id = ? ORDER BY created_at DESC LIMIT 20",
            (user["id"], lessonId),
        ).fetchall()
    return response([attempt_data(row) for row in rows])
```

Выбирайте последние 20 попыток этого пользователя по этому уроку, новые первыми. В `data` верните список обычных объектов попыток с отправленным кодом. Если строк нет, ответ:

```json
{"data": [], "meta": {"schemaVersion": "1.0"}}
```

**Результат этапа:** ученик возвращается в урок и видит свои отправки. Другой аккаунт получает свою историю.

## 13. Возвращайте состояние попытки в форме фронтенда

Пример ответа HTTP 202 на POST урока и HTTP 200 на GET попытки:

```json
{
  "data": {
    "id": "sub_001", "lessonId": "python-01", "lessonVersion": 1,
    "exerciseId": "python-01-practice", "exerciseVersion": 1,
    "language": "python", "runtimeProfileId": "python-intro-v1",
    "status": "queued", "verdict": null, "isDemo": false,
    "files": [{"path": "main.py", "code": "print('Привет, LogicKernel!')\nprint('Это моя первая программа')\n"}],
    "stdin": "", "feedback": null, "pollAfterMs": 800,
    "createdAt": "2026-10-06T10:00:00Z", "updatedAt": "2026-10-06T10:00:00Z"
  },
  "meta": {"schemaVersion": "1.0"}
}
```

Для отдельной задачи вместо четырёх полей `lessonId`, `lessonVersion`, `exerciseId`, `exerciseVersion` нужны `taskId` и `taskVersion`. `attempt_data()` в примере сохраняет эти поля из исходной отправки.

| Поля состояния | Что показывает фронтенд |
| --- | --- |
| `status: "queued"`, `verdict: null` | Попытка сохранена, ожидает обработки. |
| `status: "running"`, `verdict: null` | Обработка идёт. |
| `status: "finished"`, заполненный `verdict` | Готовый результат и `feedback.summary`. |
| `status: "failed"`, `verdict: "internal_error"` | Сообщение о сбое из `feedback.summary`. |

Итоговые значения `verdict`, которые понимает интерфейс: `accepted`, `wrong_answer`, `compilation_error`, `runtime_error`, `time_limit`, `memory_limit`, `internal_error`. Подробности при наличии передавайте внутри `feedback`: `summary`, `stdout`, `stderr`, `diagnostics`, `tests`; форма есть в `examples/submission-accepted.json` и схеме ответа.

Этот учебный пример сохраняет попытки со статусом `queued`. Для текущего этапа ваша работа — принять, сохранить и отдать состояние записи. GET читает запись, повторный GET не создаёт новую попытку.

Фронтенд запрашивает состояние примерно раз в 800 мс и прекращает ожидание через 30 секунд. Это не удаляет запись: она остаётся доступной по ID и в истории. В ответах сохраняйте ID и версии первоначальной отправки; интерфейс сравнивает их с открытым заданием.

## 14. Подключите раздачу страниц и запустите свой сервер

Все функции и адреса API объявляйте выше раздачи `public/`. В самом конце своего `backend/app.py` добавьте:


```python
@app.api_route("/api/v1/{unknown:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
def unknown_api(unknown: str):
    raise APIError(404, "NOT_FOUND", "Адрес API не найден.")
```

```python
app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="frontend")
```

Из корня `LogicKernel` запустите **свой** файл:

```bash
.venv/bin/python -m uvicorn app:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

Откройте `http://127.0.0.1:8000/`. Остановка сервера — Ctrl+C. Изменения исходных файлов фронтенда повторно копируйте в `public/`.

Для просмотра поведения полного **учебного примера** можно отдельно запустить его вместо своего сервера:

```bash
.venv/bin/python backend-package/examples/python_backend.py
```

Он использует те же материалы и `public/`. На этом адресе одновременно запускайте один сервер. Код примера предназначен для разбора и написания вашей реализации.

### Когда проект готов: перенос на Linux VDS

Перенесите на VDS `public/`, свой `backend/` и `backend-package/`, сохранив расположение из шага 1. На VDS заново создайте `.venv` и установите зависимости своего бэкенда: окружение с компьютера не переносится. Если приложение использует зависимости учебного примера, подойдут команды установки из шага 1.

На VDS запускайте своё приложение без `--reload`:

```bash
.venv/bin/python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

`127.0.0.1:8000` — внутренний адрес приложения на VDS. Настройте Nginx или другой веб-сервер так, чтобы HTTPS-запросы вашего домена передавались этому приложению: и `/`, и `/api/v1/`. Тогда сайт и API доступны на одном домене, а строки `baseUrl: '/api/v1'` достаточно. Постоянный запуск приложения настройте через службу, например systemd.

## 15. Держите под рукой адреса и ошибки

| Адрес | Что получить / вернуть | Вход нужен |
| --- | --- | --- |
| `GET /api/v1/auth/session` | HTTP 200: `{user, csrfToken}`, при необходимости `Set-Cookie`. | Нет |
| `POST /api/v1/auth/register` | `{name,surname,email,password}` → HTTP 201: `{user,csrfToken}` и новая cookie. | Нет; нужна cookie сессии |
| `POST /api/v1/auth/login` | `{email,password}` → HTTP 200: `{user,csrfToken}` и новая cookie. | Нет; нужна cookie сессии |
| `POST /api/v1/auth/logout` | `{}` → HTTP 200: `{user:null,csrfToken}` и новая гостевая cookie. | Нет; нужна cookie сессии |
| `PATCH /api/v1/me` | `{name,surname,bio}` → HTTP 200: обновлённые `{user,csrfToken}`. | Да |
| `GET /api/v1/courses` | HTTP 200: целиком `responses/courses/index.json`. | Нет |
| `GET /api/v1/courses/{id}` | HTTP 200: целиком `responses/courses/{id}.json`. | Нет |
| `GET /api/v1/lessons/{id}` | HTTP 200: целиком `responses/lessons/{id}.json`. | Нет |
| `POST /api/v1/submissions` | Тело из шага 9 → HTTP 202: объект попытки. | Да |
| `GET /api/v1/submissions/{id}` | HTTP 200: объект этой попытки пользователя. | Да |
| `GET /api/v1/submissions?lessonId=…` | HTTP 200: массив последних попыток пользователя по уроку. | Да |
| `POST /api/v1/task-submissions` | Тело отдельной задачи → HTTP 202: объект попытки. | Да |
| `GET /api/v1/task-submissions/{id}` | HTTP 200: объект попытки отдельной задачи. | Да |

В таблице содержимое успешного ответа указано для `data`; вокруг него всегда есть `meta.schemaVersion: "1.0"`. Все POST и PATCH используют `X-CSRF-Token`. Оба POST решений также используют `Idempotency-Key`.

Ошибка имеет другой вид:

```json
{"error":{"code":"EMAIL_ALREADY_EXISTS","message":"Эта почта уже зарегистрирована. Войдите в аккаунт.","details":null}}
```

| HTTP / `error.code` | Действие, которое привело к ошибке |
| --- | --- |
| `400 INVALID_REQUEST` | Неверные поля, состав файлов или язык. |
| `401 INVALID_CREDENTIALS` | Неверная почта или пароль при входе. |
| `401 UNAUTHENTICATED` | Действие требует вошедшего пользователя. |
| `403 INVALID_CSRF_TOKEN` | Токен не относится к действующей сессии. |
| `404 NOT_FOUND` | Материал или доступная пользователю попытка не найдены. |
| `409 EMAIL_ALREADY_EXISTS` | Повторная регистрация почты. |
| `409 CONTENT_VERSION_MISMATCH` | Отправка для устаревшей версии задания. |
| `409 IDEMPOTENCY_CONFLICT` | Один ключ использован для разных тел отправки. |
| `413 PAYLOAD_TOO_LARGE` | Превышен размер текста. |
| `429 RATE_LIMITED` | Слишком частые обращения ко входу и регистрации. |

Все ответы API возвращайте JSON. `error.message` будет показан человеку. Даже после сетевой ошибки фронтенд может повторить отправку; поэтому одинаковый ключ должен находить уже созданную запись.

## 16. Как вместе проверять каждый написанный этап

Пользуйтесь F12 → **Network / Сеть**: действие на странице → запрос → тело запроса → ответ сервера. Так видно, какая ваша функция сейчас нужна и что она вернула.

| Вы закончили писать | Сделайте на странице | Что должно получиться |
| --- | --- | --- |
| Три GET материалов | Откройте каталог, Python, первый урок. | Три адреса из шага 4 ответили 200; материалы открылись. |
| Сессию и регистрацию | Создайте аккаунт и обновите страницу. | POST дал 201; GET сессии вернул того же пользователя. |
| Вход и выход | Выйдите, попробуйте неверный пароль, затем верный. | Гость → ошибка в форме → снова ваш профиль. |
| PATCH профиля | Измените имя и описание, обновите страницу. | Изменения сохранились в БД и вернулись из GET сессии. |
| POST решения | Напишите текст в редакторе и отправьте. | HTTP 202, один ID, новая строка в `attempts`. |
| GET попытки и истории | Вернитесь в тот же урок. | Видна отправленная попытка с её прежним текстом. |
| Принадлежность данных | Войдите вторым аккаунтом. | Его история отдельная; чужую попытку получить нельзя. |

Для обсуждения берите одну строку этой таблицы, находите соответствующие функции выше и реализуйте их у себя. Не нужно писать все возможности одновременно.

**Что ещё пока хранится в браузере:** черновики, отметки прочитанного, отображаемый прогресс, настройки обучения, подписка Demo и сертификаты. Черновики и локальные данные разделяются по аккаунтам. Для их серверной синхронизации позже добавите отдельные API и вызовы фронтенда. Сейчас сервером уже предусмотрены аккаунт, профиль и отправленные попытки.

На HTTPS-сервере пример выставляет cookie с `Secure`; за прокси при необходимости задайте `LK_COOKIE_SECURE=1`. Держите БД и материалы вне `public/`.

Исходные учебные материалы редактируйте в `content/`, затем выполните `node tools/build-content.mjs` на компьютере разработчика с установленным Node.js. После изменений README или материалов обновите копию инструкции и ZIP командой `python3 tools/package-backend.py`. Для запуска описанного Python-бэкенда Node.js не требуется.

Использованные интерфейсы библиотек: [FastAPI: ответы и cookie](https://fastapi.tiangolo.com/advanced/response-cookies/), [argon2-cffi: hash и verify](https://argon2-cffi.readthedocs.io/en/stable/howto.html), [Python: SQLite](https://docs.python.org/3/library/sqlite3.html).
