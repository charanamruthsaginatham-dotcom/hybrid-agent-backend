"""
HYBRID AGENT - model providers
==============================

One tiny client per model channel, all on the standard library, so nothing has
to be pip-installed to talk to a model:

    gemini  -> Google Generative Language REST
    claude  -> Anthropic Messages REST
    ollama  -> whatever is running on this machine at 127.0.0.1:11434
    custom  -> any OpenAI-chat-completions-compatible endpoint the user adds

Keys are stored **per account** in config.json, under that account's own entry
- never in one shared place every visitor draws from. Ollama needs no key and
stays available to anyone, signed in or not, because there is no secret to
protect. Gemini, Claude and any custom provider need a signed-in account with
its own stored key; see auth.py for how accounts work.

`auth.LOCAL_PROFILE` is the one account with no password: it belongs to the
command-line tools (configure.py, hybrid_agent.py), which already run as
whoever has terminal access to this machine. That account can also fall back
to GEMINI_API_KEY / ANTHROPIC_API_KEY from the environment; web accounts never
get that fallback, so an env var on the server can't quietly answer for
someone else's browser session.

Keys are never printed, never logged, and never leave the machine except in
the request to that provider.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
LOCAL_PROFILE = "__local__"

#: Built-in channel definitions. `env` lets an environment variable stand in
#: for a stored key, but only for LOCAL_PROFILE - see the module docstring.
CHANNELS = {
    "gemini": {
        "label": "Google Gemini",
        "needs_key": True,
        "env": "GEMINI_API_KEY",
        "default_model": "gemini-2.5-flash",
        "models": ("gemini-2.5-flash", "gemini-2.5-pro"),
        "keys_url": "https://aistudio.google.com/apikey",
    },
    "claude": {
        "label": "Anthropic Claude",
        "needs_key": True,
        "env": "ANTHROPIC_API_KEY",
        "default_model": "claude-sonnet-5",
        "models": ("claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"),
        "keys_url": "https://console.anthropic.com/settings/keys",
    },
    "ollama": {
        "label": "Local Ollama",
        "needs_key": False,
        "env": "",
        "default_model": "llama3.2:3b",
        "models": (),                      # filled in live from the daemon
        "keys_url": "",
    },
}

SYSTEM_PROMPT = (
    "You are A.D.A, the assistant behind a gesture-controlled desktop console. "
    "Answer in at most four sentences, plainly, no preamble."
)

BUILD_PROMPT = (
    "You are the code generator behind a web app builder, like bolt.new. "
    "The user describes an app; you build it as ONE complete, self-contained HTML "
    "document with all CSS in a <style> tag and all JavaScript in a <script> tag. "
    "It must run as-is inside a sandboxed iframe: no build step, no imports of local "
    "files, no fetch to a backend, no localStorage requirement (wrap storage in try/catch). "
    "External libraries only from https://cdn.jsdelivr.net or https://cdnjs.cloudflare.com, "
    "fonts only from Google Fonts. Make it polished, responsive and genuinely functional, "
    "not a mock-up.\n\n"
    "When the user sends the current code with a change request, return the FULL updated "
    "document, never a diff or a fragment.\n\n"
    "Reply format, exactly: one or two plain sentences saying what you built or changed, "
    "then a single ```html fenced block holding the whole document. Nothing after the block."
)

#: mode -> (system prompt, output-token budget, request timeout in seconds)
MODES = {
    "chat": (SYSTEM_PROMPT, 600, 60),
    "build": (BUILD_PROMPT, 16000, 300),
    "agent": ("", 8000, 180),       # system prompt filled in by serve.py from nexus_tools
}

CUSTOM_ID_OK = re.compile(r"^[a-z][a-z0-9-]{1,23}$")


# ----------------------------------------------------------------- config
def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cfg = {}
    else:
        cfg = {}
    return _migrate(cfg)


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    if os.name != "nt":
        os.chmod(CONFIG_PATH, 0o600)


def _migrate(cfg: dict) -> dict:
    """Fold the old single-profile shape (keys/models at top level) into the
    reserved local profile, once. Older configs never had accounts at all."""
    legacy_keys = cfg.pop("keys", None)
    legacy_models = dict(cfg.pop("models", None) or {})
    legacy_default = cfg.pop("default", None)
    users = cfg.setdefault("users", {})
    if legacy_keys or legacy_models or legacy_default:
        local = users.setdefault(LOCAL_PROFILE, _blank_profile())
        local["keys"].update(legacy_keys or {})
        ollama_model = legacy_models.pop("ollama", None)     # now a machine setting, not per-profile
        if ollama_model and "ollama_model" not in cfg:
            cfg["ollama_model"] = ollama_model
        local["models"].update(legacy_models)
        if legacy_default:
            local["default"] = legacy_default
    users.setdefault(LOCAL_PROFILE, _blank_profile())
    return cfg


def _blank_profile() -> dict:
    return {"keys": {}, "models": {}, "custom": {}, "apps": {}, "default": "ollama"}


def _profile(user: str, cfg: dict | None = None) -> dict:
    cfg = load_config() if cfg is None else cfg
    users = cfg.setdefault("users", {})
    return users.get(user) or _blank_profile()


def blank_profile() -> dict:
    """A fresh, empty account profile - the shape every account has."""
    return _blank_profile()


def get_profile(user: str, cfg: dict | None = None) -> dict:
    """Read-only: this account's profile, or a blank one if it has none yet."""
    return _profile(user, cfg)


def ensure_profile(cfg: dict, user: str) -> dict:
    """The live, mutable profile dict inside `cfg` for this account, creating
    it first if this is the account's first write. Other modules (apps.py)
    use this instead of reaching into providers' own config-file layout."""
    return cfg.setdefault("users", {}).setdefault(user, _blank_profile())


def known_users(cfg: dict | None = None) -> list:
    """Real, signed-in-able accounts - the reserved local profile is not one."""
    cfg = load_config() if cfg is None else cfg
    return sorted(u for u, row in cfg.get("users", {}).items()
                  if u != LOCAL_PROFILE and "hash" in row)


def get_key(channel: str, user: str, cfg: dict | None = None) -> str:
    """This account's stored key. LOCAL_PROFILE alone may fall back to an
    environment variable, since that account is the machine owner's own CLI."""
    cfg = load_config() if cfg is None else cfg
    stored = _profile(user, cfg).get("keys", {}).get(channel, "")
    if stored:
        return stored
    if user == LOCAL_PROFILE:
        env = CHANNELS.get(channel, {}).get("env", "")
        return os.environ.get(env, "") if env else ""
    return ""


def set_key(channel: str, key: str, user: str) -> None:
    cfg = load_config()
    row = cfg.setdefault("users", {}).setdefault(user, _blank_profile())
    row.setdefault("keys", {})[channel] = key.strip()
    save_config(cfg)


def get_model(channel: str, user: str, cfg: dict | None = None) -> str:
    cfg = load_config() if cfg is None else cfg
    if channel == "ollama":                # a machine setting, not a secret
        return cfg.get("ollama_model") or CHANNELS["ollama"]["default_model"]
    chosen = _profile(user, cfg).get("models", {}).get(channel)
    return chosen or CHANNELS.get(channel, {}).get("default_model", "")


def set_model(channel: str, model: str, user: str) -> None:
    cfg = load_config()
    if channel == "ollama":
        cfg["ollama_model"] = model
    else:
        row = cfg.setdefault("users", {}).setdefault(user, _blank_profile())
        row.setdefault("models", {})[channel] = model
    save_config(cfg)


def default_channel(user: str | None) -> str:
    if not user:
        return "ollama"
    return _profile(user).get("default", "ollama")


def set_default(channel: str, user: str) -> None:
    cfg = load_config()
    row = cfg.setdefault("users", {}).setdefault(user, _blank_profile())
    row["default"] = channel
    save_config(cfg)


def mask(key: str) -> str:
    if not key:
        return ""
    return f"{key[:6]}…{key[-4:]}" if len(key) > 12 else "set"


# ----------------------------------------------------------------- custom LLMs
def custom_llms(user: str, cfg: dict | None = None) -> dict:
    return dict(_profile(user, cfg).get("custom", {}))


def add_custom(user: str, label: str, base_url: str, key: str, model: str) -> dict:
    label = (label or "").strip()
    base_url = (base_url or "").strip().rstrip("/")
    model = (model or "").strip()
    if not label:
        return {"ok": False, "error": "give the model a short name"}
    if not (base_url.startswith("https://") or base_url.startswith("http://")):
        return {"ok": False, "error": "base URL must start with https:// (or http:// for a local server)"}
    if not model:
        return {"ok": False, "error": "give the exact model name the endpoint expects"}

    cid = re.sub(r"[^a-z0-9-]+", "-", label.lower()).strip("-")[:24] or "model"
    if not cid[0].isalpha():
        cid = "m-" + cid
    cfg = load_config()
    row = cfg.setdefault("users", {}).setdefault(user, _blank_profile())
    custom = row.setdefault("custom", {})
    base = cid
    n = 2
    while cid in custom:
        cid = f"{base}-{n}"
        n += 1
    custom[cid] = {"label": label, "base_url": base_url, "key": key.strip(), "model": model}
    save_config(cfg)
    return {"ok": True, "id": cid, "note": f"added {label}"}


def remove_custom(user: str, cid: str) -> bool:
    cfg = load_config()
    custom = cfg.setdefault("users", {}).setdefault(user, _blank_profile()).setdefault("custom", {})
    if cid in custom:
        del custom[cid]
        save_config(cfg)
        return True
    return False


# ----------------------------------------------------------------- http
def _post(url: str, payload: dict, headers: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _error(exc: Exception) -> str:
    """Readable one-liner. Provider bodies can echo the key, so never include one."""
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = json.loads(exc.read().decode("utf-8"))
            msg = (body.get("error") or {})
            msg = msg.get("message") if isinstance(msg, dict) else str(msg)
        except Exception:
            msg = exc.reason
        return f"HTTP {exc.code}: {msg}"
    if isinstance(exc, urllib.error.URLError):
        return f"cannot reach provider: {exc.reason}"
    return str(exc)


# ----------------------------------------------------------------- channels
def ollama_models() -> list:
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=4) as r:
            data = json.loads(r.read().decode("utf-8"))
        return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def ask_gemini(prompt: str, model: str, key: str, mode: str = "chat") -> dict:
    system, budget, timeout = MODES[mode]
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": budget},
    }
    data = _post(url, payload, {}, timeout=timeout)
    parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])
    return {"text": "".join(p.get("text", "") for p in parts).strip(),
            "model": model, "usage": data.get("usageMetadata", {})}


def ask_claude(prompt: str, model: str, key: str, mode: str = "chat") -> dict:
    system, budget, timeout = MODES[mode]
    payload = {
        "model": model,
        "max_tokens": budget,
        "temperature": 0.4,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = _post("https://api.anthropic.com/v1/messages", payload,
                 {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=timeout)
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return {"text": text.strip(), "model": data.get("model", model),
            "usage": data.get("usage", {})}


def ask_ollama(prompt: str, model: str, _key: str = "", mode: str = "chat") -> dict:
    """Streamed from Ollama and joined here: a CPU-bound model can take minutes to
    finish a long reply, and a non-streamed request sits silent until the end."""
    system, budget, _timeout = MODES[mode]
    payload = {
        "model": model,
        "stream": True,
        "options": {"temperature": 0.4, "num_predict": budget},
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat", data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"})
    parts, last = [], {}
    # the timeout is per read: it only fires if Ollama goes quiet for this long
    with urllib.request.urlopen(req, timeout=600) as r:
        for line in r:
            if not line.strip():
                continue
            last = json.loads(line.decode("utf-8"))
            if last.get("error"):
                raise RuntimeError(last["error"])
            parts.append((last.get("message") or {}).get("content", ""))
            if last.get("done"):
                break
    return {"text": "".join(parts).strip(), "model": last.get("model", model),
            "usage": {"eval_count": last.get("eval_count")}}


def ask_custom(prompt: str, entry: dict, mode: str = "chat") -> dict:
    """Generic OpenAI-chat-completions-compatible call - covers Mistral, Groq,
    OpenRouter, DeepSeek, Together, a local llama.cpp/LM Studio server, etc."""
    system, budget, timeout = MODES[mode]
    payload = {
        "model": entry["model"],
        "temperature": 0.4,
        "max_tokens": budget,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": prompt}],
    }
    headers = {"Authorization": f"Bearer {entry['key']}"} if entry.get("key") else {}
    data = _post(f"{entry['base_url']}/chat/completions", payload, headers, timeout=max(timeout, 90))
    choice = (data.get("choices") or [{}])[0]
    text = (choice.get("message") or {}).get("content", "") or choice.get("text", "")
    return {"text": text.strip(), "model": data.get("model", entry["model"]),
            "usage": data.get("usage", {})}


ASK = {"gemini": ask_gemini, "claude": ask_claude, "ollama": ask_ollama}


def ask(prompt: str, channel: str = "", model: str = "", user: str | None = None,
        mode: str = "chat") -> dict:
    """Route one prompt. Always returns a dict; never raises for provider faults."""
    if mode not in MODES:
        return {"ok": False, "error": f"unknown mode: {mode}"}
    channel = (channel or default_channel(user)).lower()

    if channel.startswith("custom:"):
        if not user:
            return {"ok": False, "needs_login": True,
                    "error": "sign in to use a model you added"}
        entry = custom_llms(user).get(channel[len("custom:"):])
        if not entry:
            return {"ok": False, "error": "that model was not found - it may have been removed"}
        try:
            out = ask_custom(prompt, entry, mode)
        except Exception as exc:                    # noqa: BLE001
            return {"ok": False, "channel": channel, "model": entry["model"], "error": _error(exc)}
        if not out.get("text"):
            return {"ok": False, "channel": channel, "model": entry["model"],
                    "error": "the model returned an empty response"}
        out.update({"ok": True, "channel": channel, "label": entry["label"]})
        return out

    if channel not in CHANNELS:
        return {"ok": False, "error": f"unknown channel: {channel}"}
    spec = CHANNELS[channel]

    if spec["needs_key"] and not user:
        return {"ok": False, "channel": channel, "needs_login": True,
                "error": f"sign in to use {spec['label']} - each account uses its own key, "
                         f"never one shared with every visitor"}

    key = get_key(channel, user) if user else ""
    if spec["needs_key"] and not key:
        return {"ok": False, "channel": channel, "needs_key": True,
                "error": f"No API key for {spec['label']} on this account. Add one in the "
                         f"console's KEYS panel. Get one at {spec['keys_url']}"}

    model = model or get_model(channel, user or LOCAL_PROFILE)
    if channel == "ollama":
        have = ollama_models()
        if not have:
            return {"ok": False, "channel": channel,
                    "error": f"Ollama is not answering at {OLLAMA_HOST}. Start it with  ollama serve"}
        if model not in have:
            model = have[0]

    try:
        out = ASK[channel](prompt, model, key, mode)
    except Exception as exc:                       # noqa: BLE001 - reported, not raised
        return {"ok": False, "channel": channel, "model": model, "error": _error(exc)}

    if not out.get("text"):
        return {"ok": False, "channel": channel, "model": model,
                "error": "the model returned an empty response"}
    out.update({"ok": True, "channel": channel, "label": spec["label"]})
    return out


def status(user: str | None) -> list:
    """What each channel can do right now for this account - the console's KEYS panel.
    `user=None` is a signed-out visitor: only Ollama (no secret) is usable."""
    cfg = load_config()
    rows = []
    for key, spec in CHANNELS.items():
        stored = get_key(key, user, cfg) if user else ""
        row = {
            "channel": key,
            "label": spec["label"],
            "needs_key": spec["needs_key"],
            "needs_login": spec["needs_key"] and not user,
            "has_key": bool(stored) or not spec["needs_key"],
            "masked": mask(stored),
            "model": get_model(key, user or LOCAL_PROFILE, cfg),
            "models": list(spec["models"]),
            "keys_url": spec["keys_url"],
            "default": default_channel(user) == key,
            "custom": False,
        }
        if key == "ollama":
            live = ollama_models()
            row["models"] = live
            row["has_key"] = bool(live)
            row["ready_note"] = "running" if live else "not running"
        rows.append(row)

    if user:
        for cid, entry in custom_llms(user, cfg).items():
            channel = f"custom:{cid}"
            rows.append({
                "channel": channel, "label": entry["label"], "needs_key": True,
                "needs_login": False, "has_key": bool(entry.get("key")),
                "masked": mask(entry.get("key", "")), "model": entry["model"],
                "models": [entry["model"]], "keys_url": "",
                "default": default_channel(user) == channel,
                "custom": True, "base_url": entry["base_url"],
            })
    return rows
