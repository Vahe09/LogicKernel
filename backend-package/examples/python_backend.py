"""Учебный пример API. Команда пишет собственный бэкенд, сверяясь с README.

Пример показывает материалы, регистрацию, сессии, профиль и хранение попыток.
"""

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

PACKAGE = Path(__file__).resolve().parents[1]
PUBLIC = PACKAGE.parent / "public"
DATA_DIR = Path(os.environ.get("LK_DATA_DIR", str(PACKAGE.parent / ".local-backend")))
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


@asynccontextmanager
async def lifespan(app):
    init_database()
    yield


app = FastAPI(lifespan=lifespan)


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


class LoginInput(Input):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ProfileInput(Input):
    name: str = Field(min_length=1, max_length=30)
    surname: str = Field(min_length=1, max_length=40)
    bio: str = Field(max_length=300)


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


def session_data(session):
    with database() as db:
        user = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    return {"user": public_user(user) if user else None, "csrfToken": session["csrf_token"]}


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


@app.get("/api/v1/auth/session")
def get_auth_session(request: Request):
    session = load_session(request)
    return response(session_data(session)) if session else new_session(request)


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


@app.post("/api/v1/auth/logout")
def logout(request: Request):
    require_csrf(request)
    return new_session(request)


@app.patch("/api/v1/me")
def update_profile(request: Request, body: ProfileInput):
    user = require_user(request)
    session = require_csrf(request)
    with database() as db:
        db.execute("UPDATE users SET name = ?, surname = ?, bio = ? WHERE id = ?", (body.name, body.surname, body.bio, user["id"]))
    return response(session_data(session))


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


@app.api_route("/api/v1/{unknown:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
def unknown_api(unknown: str):
    raise APIError(404, "NOT_FOUND", "Адрес API не найден.")


# Раздаётся только public/. Материалы, БД и пароли в эту папку не помещайте.
if PUBLIC.is_dir():
    app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
