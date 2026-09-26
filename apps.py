"""
HYBRID AGENT - app registry and launcher
==================================

Everything opens as an https web app, EXCEPT WhatsApp, which opens the desktop
client through its whatsapp:// protocol and only falls back to the web if the
client is not installed. A handful of native Windows apps are registered too.

Security, deliberately: `launch()` only accepts a KEY from the registry below,
or a "custom:<id>" key that resolves to a URL an account already vetted and
saved through `add_custom()` - never a path, a URL or a command handed in at
launch time. That keeps the invariant intact even with user-added apps: the
local HTTP bridge in serve.py can still never be talked into running an
arbitrary program, only opening a link someone deliberately saved earlier.

Custom apps are scoped per account (see auth.py / providers.py), the same way
custom LLMs are - one person's shortcuts do not clutter, or get launched by,
anyone else's session.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
import webbrowser
from dataclasses import dataclass, field

import providers

WINDOWS = platform.system() == "Windows"


@dataclass(frozen=True)
class App:
    key: str
    label: str
    url: str = ""                       # https, the default route
    protocol: str = ""                  # tried first when set (WhatsApp)
    exe: tuple = field(default_factory=tuple)   # native Windows executables
    group: str = "web"


#: The allowlist. Nothing outside this can be launched.
APPS = (
    # --- desktop-first -----------------------------------------------------
    App("whatsapp", "WhatsApp", url="https://web.whatsapp.com",
        protocol="whatsapp://", group="desktop"),

    # --- https web apps ----------------------------------------------------
    App("youtube",  "YouTube",   url="https://www.youtube.com"),
    App("gmail",    "Gmail",     url="https://mail.google.com"),
    App("drive",    "Drive",     url="https://drive.google.com"),
    App("maps",     "Maps",      url="https://maps.google.com"),
    App("github",   "GitHub",    url="https://github.com"),
    App("claude",   "Claude",    url="https://claude.ai"),
    App("gemini",   "Gemini",    url="https://gemini.google.com"),
    App("chatgpt",  "ChatGPT",   url="https://chatgpt.com"),
    App("spotify",  "Spotify",   url="https://open.spotify.com"),
    App("netflix",  "Netflix",   url="https://www.netflix.com"),
    App("x",        "X",         url="https://x.com"),
    App("linkedin", "LinkedIn",  url="https://www.linkedin.com"),
    App("instagram", "Instagram", url="https://www.instagram.com"),

    # --- native Windows apps ----------------------------------------------
    App("explorer", "File Explorer", exe=("explorer.exe",), group="system"),
    App("notepad",  "Notepad",       exe=("notepad.exe",), group="system"),
    App("calc",     "Calculator",    protocol="calculator://",
        exe=("calc.exe",), group="system"),
    App("settings", "Settings",      protocol="ms-settings:", group="system"),
    App("terminal", "Terminal",      exe=("wt.exe", "powershell.exe"), group="system"),
    App("vscode",   "VS Code",       exe=("code.cmd", "code.exe"),
        protocol="vscode://", group="system"),
    App("camera",   "Camera",        protocol="microsoft.windows.camera:", group="system"),
)

BY_KEY = {a.key: a for a in APPS}


def find(name: str) -> App | None:
    """Resolve a key, a label, or an unambiguous fragment ('whats' -> whatsapp)."""
    q = (name or "").strip().lower()
    if not q:
        return None
    if q in BY_KEY:
        return BY_KEY[q]
    for a in APPS:
        if a.label.lower() == q:
            return a
    hits = [a for a in APPS if q in a.key or q in a.label.lower()]
    return hits[0] if len(hits) == 1 else None


def _open_protocol(proto: str) -> bool:
    try:
        if WINDOWS:
            os.startfile(proto)                                  # noqa: S606
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", proto])
        else:
            subprocess.Popen(["xdg-open", proto])
        return True
    except OSError:
        return False


def _open_exe(names: tuple) -> str | None:
    for n in names:
        path = shutil.which(n)
        if path:
            try:
                subprocess.Popen([path], shell=False)
                return n
            except OSError:
                continue
    return None


def launch(key: str, user: str | None = None) -> dict:
    """Open one registered app. Returns what actually happened."""
    key = (key or "").strip()

    if key.lower().startswith("custom:"):
        if not user:
            return {"ok": False, "needs_login": True,
                    "error": "sign in to open an app you added"}
        entry = custom_apps(user).get(key[len("custom:"):].lower())
        if not entry:
            return {"ok": False, "error": "that app was not found - it may have been removed"}
        webbrowser.open(entry["url"])
        return {"ok": True, "app": key, "label": entry["label"],
                "via": "https", "target": entry["url"]}

    app = find(key)
    if app is None:
        return {"ok": False, "error": f"unknown app: {key}"}

    # WhatsApp (and anything else with a protocol) prefers its desktop client
    if app.protocol and _open_protocol(app.protocol):
        return {"ok": True, "app": app.key, "label": app.label,
                "via": "protocol", "target": app.protocol}

    if app.exe:
        used = _open_exe(app.exe)
        if used:
            return {"ok": True, "app": app.key, "label": app.label,
                    "via": "exe", "target": used}

    if app.url:
        webbrowser.open(app.url)
        return {"ok": True, "app": app.key, "label": app.label,
                "via": "https", "target": app.url}

    return {"ok": False, "app": app.key,
            "error": f"{app.label} is not installed and has no web version"}


def catalogue(user: str | None = None) -> list:
    built_in = [{"key": a.key, "label": a.label, "url": a.url,
                "group": a.group, "desktop": bool(a.protocol or a.exe),
                "custom": False} for a in APPS]
    if not user:
        return built_in
    # a user's own apps lead the list, so search and the launcher panel
    # surface what someone just added before the 21 built-in defaults
    mine = [{"key": "custom:" + cid, "label": e["label"], "url": e["url"],
            "group": "custom", "desktop": False, "custom": True}
           for cid, e in custom_apps(user).items()]
    return mine + built_in


# ------------------------------------------------------------------ custom apps
def custom_apps(user: str, cfg: dict | None = None) -> dict:
    return dict(providers.get_profile(user, cfg).get("apps", {}))


def add_custom(user: str, label: str, url: str) -> dict:
    label = (label or "").strip()
    url = (url or "").strip()
    if not label:
        return {"ok": False, "error": "give the app a short name"}
    if not (url.startswith("https://") or url.startswith("http://")):
        return {"ok": False, "error": "the address must start with https:// (or http:// for a local page)"}

    cid = re.sub(r"[^a-z0-9-]+", "-", label.lower()).strip("-")[:24] or "app"
    if not cid[0].isalpha():
        cid = "a-" + cid
    cfg = providers.load_config()
    apps_ = providers.ensure_profile(cfg, user).setdefault("apps", {})
    base, n = cid, 2
    while cid in apps_:
        cid = f"{base}-{n}"; n += 1
    apps_[cid] = {"label": label, "url": url}
    providers.save_config(cfg)
    return {"ok": True, "id": cid, "note": f"added {label}"}


def remove_custom(user: str, cid: str) -> bool:
    cfg = providers.load_config()
    apps_ = providers.ensure_profile(cfg, user).setdefault("apps", {})
    if cid in apps_:
        del apps_[cid]
        providers.save_config(cfg)
        return True
    return False


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(launch(" ".join(sys.argv[1:])))
    else:
        for a in APPS:
            route = a.protocol or (a.exe[0] if a.exe else a.url)
            print(f"  {a.key:<10} {a.label:<15} {a.group:<8} {route}")
