"""
HYBRID AGENT - accounts
========================

Real username/password accounts for the web console, so a shared or hosted
console no longer answers every visitor with the machine owner's API key.
Sign in, and *your* stored key answers your prompts; stay signed out and only
the free local Ollama channel (no secret involved) is live.

Passwords are hashed with PBKDF2-SHA256 (260,000 rounds) and a random salt per
account - the plaintext password is never written anywhere, only the hash.
Sessions are random tokens held in memory only: they reset if the bridge
restarts, and nothing about a session is ever written to disk.

This is deliberately separate from the command-line tools (configure.py,
hybrid_agent.py), which already run as whoever is sitting at this keyboard and
has full filesystem access to config.json - a CLI password would be theatre,
not security. Terminal use keeps its keys under a fixed local profile
(LOCAL_PROFILE) that has no password hash, so the web login can never reach it.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time

import providers

LOCAL_PROFILE = "__local__"          # command-line tools only; no password, no web login
ITERATIONS = 260_000
NAME_OK = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{2,19}$")

_sessions: dict[str, dict] = {}      # token -> {"user": str, "created": float}


def _hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS).hex()


def valid_username(name: str) -> bool:
    return bool(NAME_OK.match(name or ""))


def _users(cfg: dict | None = None) -> dict:
    cfg = providers.load_config() if cfg is None else cfg
    return cfg.setdefault("users", {})


def _find(username: str, cfg: dict | None = None) -> tuple[str | None, dict | None]:
    users = _users(cfg)
    for name, row in users.items():
        if name.lower() == (username or "").lower():
            return name, row
    return None, None


def exists(username: str) -> bool:
    name, _ = _find(username)
    return name is not None


def register(username: str, password: str) -> dict:
    username = (username or "").strip()
    if not valid_username(username):
        return {"ok": False, "error": "username: 3-20 characters, start with a letter, "
                                      "then letters, numbers, - or _"}
    if username.lower() == LOCAL_PROFILE.lower():
        return {"ok": False, "error": "that name is reserved"}
    if len(password or "") < 8:
        return {"ok": False, "error": "password needs at least 8 characters"}
    if exists(username):
        return {"ok": False, "error": "that username is taken"}

    cfg = providers.load_config()
    users = _users(cfg)
    salt = os.urandom(16)
    users[username] = {
        "salt": salt.hex(), "hash": _hash(password, salt),
        "keys": {}, "models": {}, "custom": {}, "default": "ollama",
        "created": time.time(),
    }
    providers.save_config(cfg)
    return {"ok": True, "user": username, "token": _open_session(username)}


def login(username: str, password: str) -> dict:
    name, row = _find(username or "")
    if not row or "hash" not in row:
        return {"ok": False, "error": "no account with that username"}
    salt = bytes.fromhex(row["salt"])
    if not hmac.compare_digest(_hash(password or "", salt), row["hash"]):
        return {"ok": False, "error": "wrong password"}
    return {"ok": True, "user": name, "token": _open_session(name)}


def _open_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = {"user": username, "created": time.time()}
    return token


def user_for_token(token: str) -> str | None:
    row = _sessions.get(token or "")
    return row["user"] if row else None


def logout(token: str) -> None:
    _sessions.pop(token or "", None)


def session_count(username: str) -> int:
    return sum(1 for s in _sessions.values() if s["user"].lower() == (username or "").lower())
