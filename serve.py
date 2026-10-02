"""
HYBRID AGENT - serve the site
=======================

Serves site/ over http://localhost:8790 and opens it. Camera permission only
works on an http(s) origin, so this is how you run the console locally - opening
index.html as a file:// page leaves the browser refusing the camera.

    python serve.py                 # serve and open the default browser
    python serve.py --port 9000     # different port
    python serve.py --no-open       # just serve
    python serve.py --browser comet # open in Comet if it is installed
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import apps
import auth
import bluetooth
import boards
import nexus_tools
import providers

providers.MODES["agent"] = (nexus_tools.system_prompt(), *providers.MODES["agent"][1:])

def _find_site() -> Path:
    """site/ may sit beside this script or one level up, depending on layout."""
    here = Path(__file__).resolve().parent
    for candidate in (here / "site", here.parent / "site"):
        if (candidate / "index.html").exists():
            return candidate
    return here / "site"


DEFAULT_DIR = _find_site()

COMET_CANDIDATES = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Perplexity/Comet/Application/comet.exe",
    Path("/Applications/Comet.app/Contents/MacOS/Comet"),
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the site, plus a small launcher API for the console.

        GET /api/apps          -> the registry
        GET /api/open?app=KEY  -> launch that app
        GET /api/bt            -> radio state + paired devices
        GET /api/dev           -> serial boards, network hosts, phones
        GET /api/bt/connect?dev=KEY
        GET /api/auth/me       -> the signed-in account, if any
        POST /api/auth/register, /api/auth/login, /api/auth/logout
        POST /api/llm/add, /api/llm/remove  -> this account's custom models
        POST /api/apps/add, /api/apps/remove -> this account's custom apps
        POST /api/agent        -> one Nexus agent step: a tool request or a final answer
        POST /api/agent/tool   -> run one Nexus tool (local server only)
        GET  /api/agent/tools  -> the Nexus tools this server offers
        GET  /api/agent/file?name=X -> download a file the agent made

    The API only accepts a key from apps.APPS: no path, URL or command from the
    caller ever reaches the shell. It binds to 127.0.0.1 and refuses requests
    carrying a foreign Origin, so another site open in your browser cannot use
    it to start programs on your machine.

    Model keys are scoped per signed-in account (see auth.py): a visitor who
    is not signed in only gets the free local Ollama channel, never the
    machine owner's Gemini or Claude key.
    """

    SESSION_COOKIE = "ha_session"

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            sys.stderr.write(f"  404  {self.path}\n")

    def handle_one_request(self):
        """A browser can close an API poll while navigating; do not print a traceback."""
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            self.close_connection = True

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers -------------------------------------------------------
    def _json(self, payload: dict, status: int = 200, set_cookie: str | None = None) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if set_cookie is not None:
            # empty value + Max-Age=0 clears it (logout); a token sets it for 14 days,
            # though the token itself only lives as long as this process does.
            cookie = f"{self.SESSION_COOKIE}={set_cookie}; Path=/; HttpOnly; SameSite=Lax"
            cookie += "; Max-Age=0" if not set_cookie else "; Max-Age=1209600"
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:                      # same-origin fetch, or curl
            return True
        hostname = urlparse(origin).hostname
        # *.localhost always resolves to this machine, so e.g. hybrid.localhost is local too
        if hostname in {"localhost", "127.0.0.1"} or (hostname or "").endswith(".localhost"):
            return True
        if os.environ.get("RENDER"):  # Running on Render cloud
            return True
        return False

    def _token(self) -> str:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            part = part.strip()
            if part.startswith(self.SESSION_COOKIE + "="):
                return part[len(self.SESSION_COOKIE) + 1:]
        return ""

    def _user(self) -> str | None:
        """The signed-in account for this request, or None for a guest."""
        return auth.user_for_token(self._token())

    # ---- routing -------------------------------------------------------
    def do_GET(self):                           # noqa: N802
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()

        if not self._same_origin():
            return self._json({"ok": False, "error": "cross-origin request refused"}, 403)

        if parsed.path == "/api/apps":
            user = self._user()
            return self._json({"ok": True, "apps": apps.catalogue(user), "user": user})

        if parsed.path == "/api/open":
            key = (parse_qs(parsed.query).get("app") or [""])[0]
            result = apps.launch(key, self._user())
            if result.get("ok"):
                print(f"  launch  {result['label']:<14} via {result['via']:<8} {result['target']}")
            else:
                print(f"  launch refused: {result.get('error')}")
            return self._json(result, 200 if result.get("ok") else 404)

        if parsed.path.startswith("/api/bt"):
            return self._bluetooth(parsed)

        if parsed.path.startswith("/api/dev"):
            return self._devices(parsed)

        if parsed.path == "/api/agent/tools":
            return self._json({"ok": True, "local": nexus_tools.local_mode(),
                               "tools": nexus_tools.describe()})

        if parsed.path == "/api/agent/file":
            name = (parse_qs(parsed.query).get("name") or [""])[0]
            path = nexus_tools.output_file(name)
            if not path:
                return self._json({"ok": False, "error": "no such file"}, 404)
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None

        if parsed.path == "/api/models":
            user = self._user()
            return self._json({"ok": True, "channels": providers.status(user),
                               "default": providers.default_channel(user),
                               "user": user})

        if parsed.path == "/api/auth/me":
            user = self._user()
            return self._json({"ok": bool(user), "user": user})

        return self._json({"ok": False, "error": "no such endpoint"}, 404)

    # ---- bluetooth ------------------------------------------------------
    def _bluetooth(self, parsed) -> None:
        """Radio state, paired devices, and connect requests.

        `dev` is matched against the devices Windows reports as paired; no
        caller-supplied string ever reaches a shell or a device address.
        """
        q = parse_qs(parsed.query)
        tail = parsed.path[len("/api/bt"):].strip("/")

        if tail == "":
            return self._json(bluetooth.status())

        if tail == "radio":
            want = (q.get("state") or [""])[0].lower()
            if want not in ("on", "off"):
                return self._json({"ok": False, "error": "state must be on or off"}, 400)
            result = bluetooth.set_radio(want == "on")
            print(f"  bluetooth radio -> {result.get('state', want)}")
            return self._json(result, 200 if result.get("ok") else 502)

        if tail in ("connect", "disconnect"):
            key = (q.get("dev") or [""])[0]
            if not key:
                return self._json({"ok": False, "error": "no device given"}, 400)
            fn = bluetooth.connect if tail == "connect" else bluetooth.disconnect
            result = fn(key)
            print(f"  bluetooth {tail:<10} {key:<20} "
                  f"{'ok' if result.get('ok') else result.get('error', '')[:60]}")
            return self._json(result, 200 if result.get("ok") else 409)

        if tail == "pane":
            return self._json(bluetooth.pane())

        return self._json({"ok": False, "error": "no such endpoint"}, 404)

    # ---- boards, mini computers, phones ---------------------------------
    def _devices(self, parsed) -> None:
        """Serial boards, saved network hosts and adb phones.

        Every value that reaches a subprocess is checked first: a COM port must
        look like COM<n>, a host like a hostname or IP. No command string from
        the caller is ever executed.
        """
        q = parse_qs(parsed.query)
        tail = parsed.path[len("/api/dev"):].strip("/")

        if tail == "":
            return self._json(boards.scan())

        if tail == "send":
            port = (q.get("port") or [""])[0].upper()
            line = (q.get("line") or [""])[0]
            baud = (q.get("baud") or ["9600"])[0]
            try:
                baud_n = int(baud)
            except ValueError:
                return self._json({"ok": False, "error": "baud must be a number"}, 400)
            result = boards.serial_send(port, line, baud_n)
            print(f"  serial  {port:<8} {'ok' if result.get('ok') else result.get('error','')[:50]}")
            return self._json(result, 200 if result.get("ok") else 409)

        if tail == "add":
            result = boards.add_device((q.get("key") or [""])[0],
                                       (q.get("host") or [""])[0],
                                       (q.get("name") or [""])[0],
                                       (q.get("user") or [""])[0])
            return self._json(result, 200 if result.get("ok") else 400)

        if tail == "forget":
            key = (q.get("key") or [""])[0].lower()
            return self._json({"ok": boards.forget_device(key)})

        if tail == "ssh":
            return self._json(boards.ssh_hint((q.get("key") or [""])[0].lower()))

        if tail == "phone":
            verb = (q.get("do") or ["list"])[0]
            target = (q.get("target") or [""])[0]
            if verb in ("connect", "disconnect", "mirror"):
                fn = {"connect": boards.phone_connect,
                      "disconnect": boards.phone_disconnect,
                      "mirror": boards.phone_mirror}[verb]
                result = fn(target)
                print(f"  phone   {verb:<11} "
                      f"{'ok' if result.get('ok') else (result.get('error') or '')[:50]}")
                return self._json(result, 200 if result.get("ok") else 409)
            return self._json({"ok": True, "phones": boards.phones()})

        return self._json({"ok": False, "error": "no such endpoint"}, 404)

    def do_POST(self):                          # noqa: N802
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return self._json({"ok": False, "error": "no such endpoint"}, 404)
        if not self._same_origin():
            return self._json({"ok": False, "error": "cross-origin request refused"}, 403)

        length = int(self.headers.get("Content-Length") or 0)
        if length > 200_000:
            return self._json({"ok": False, "error": "payload too large"}, 413)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._json({"ok": False, "error": "bad json"}, 400)

        # ---- accounts ----------------------------------------------------
        if parsed.path == "/api/auth/register":
            res = auth.register(str(body.get("username", "")), str(body.get("password", "")))
            if not res.get("ok"):
                return self._json(res, 400)
            print(f"  account created: {res['user']}")
            return self._json({"ok": True, "user": res["user"]}, 200, set_cookie=res["token"])

        if parsed.path == "/api/auth/login":
            res = auth.login(str(body.get("username", "")), str(body.get("password", "")))
            if not res.get("ok"):
                return self._json(res, 401)
            print(f"  signed in: {res['user']}")
            return self._json({"ok": True, "user": res["user"]}, 200, set_cookie=res["token"])

        if parsed.path == "/api/auth/logout":
            auth.logout(self._token())
            return self._json({"ok": True}, 200, set_cookie="")

        # Save an API key the operator typed into the console. The key is written
        # to config.json under their own account and is never echoed back or
        # printed to this terminal. A signed-out visitor cannot store one.
        if parsed.path == "/api/key":
            user = self._user()
            if not user:
                return self._json({"ok": False, "error": "sign in first", "needs_login": True}, 401)
            channel = str(body.get("channel", ""))
            if channel not in providers.CHANNELS:
                return self._json({"ok": False, "error": f"unknown channel: {channel}"}, 404)
            providers.set_key(channel, str(body.get("key", "")), user)
            if body.get("model"):
                providers.set_model(channel, str(body["model"]), user)
            if body.get("make_default"):
                providers.set_default(channel, user)
            print(f"  key stored for {channel} · {user}")
            return self._json({"ok": True, "channels": providers.status(user)})

        # Add or remove a custom OpenAI-compatible model. Signed-in only, since
        # it carries that provider's own API key.
        if parsed.path == "/api/llm/add":
            user = self._user()
            if not user:
                return self._json({"ok": False, "error": "sign in first", "needs_login": True}, 401)
            res = providers.add_custom(user, str(body.get("label", "")), str(body.get("base_url", "")),
                                       str(body.get("key", "")), str(body.get("model", "")))
            if res.get("ok"):
                print(f"  llm added: {res['id']} · {user}")
            return self._json(res, 200 if res.get("ok") else 400)

        if parsed.path == "/api/llm/remove":
            user = self._user()
            if not user:
                return self._json({"ok": False, "error": "sign in first", "needs_login": True}, 401)
            ok = providers.remove_custom(user, str(body.get("id", "")))
            return self._json({"ok": ok}, 200 if ok else 404)

        # Add or remove a shortcut to any https page. Signed-in only, so one
        # visitor's additions never show up in - or get launched from -
        # another visitor's session.
        if parsed.path == "/api/apps/add":
            user = self._user()
            if not user:
                return self._json({"ok": False, "error": "sign in first", "needs_login": True}, 401)
            res = apps.add_custom(user, str(body.get("label", "")), str(body.get("url", "")))
            if res.get("ok"):
                print(f"  app added: {res['id']} · {user}")
            return self._json(res, 200 if res.get("ok") else 400)

        if parsed.path == "/api/apps/remove":
            user = self._user()
            if not user:
                return self._json({"ok": False, "error": "sign in first", "needs_login": True}, 401)
            ok = apps.remove_custom(user, str(body.get("id", "")))
            return self._json({"ok": ok}, 200 if ok else 404)

        if parsed.path == "/api/agent":
            messages = body.get("messages")
            if not isinstance(messages, list) or not messages:
                return self._json({"ok": False, "error": "no messages"}, 400)
            user = self._user()
            out = providers.ask(nexus_tools.transcript(messages), str(body.get("channel", "")),
                                str(body.get("model", "")), user=user, mode="agent")
            if not out.get("ok"):
                return self._json(out, 502)
            call = nexus_tools.parse_call(out["text"])
            tool = nexus_tools.available().get(call["tool"]) if call else None
            if call:
                print(f"  agent   wants {call['tool']} {json.dumps(call['args'])[:80]}")
            return self._json({
                "ok": True, "model": out.get("model"), "text": out["text"],
                "type": "tool" if call else "final",
                "tool": call["tool"] if call else None,
                "args": call["args"] if call else None,
                "risk": tool.risk if tool else "auto",
                "summary": tool.summary if tool else "",
            })

        if parsed.path == "/api/agent/tool":
            if "application/json" not in (self.headers.get("Content-Type") or ""):
                return self._json({"ok": False, "error": "json only"}, 415)
            if not nexus_tools.local_mode():
                return self._json({"ok": False, "error": "PC tools only run on the local version"}, 403)
            name = str(body.get("tool", ""))
            args = body.get("args") if isinstance(body.get("args"), dict) else {}
            print(f"  tool    {name} {json.dumps(args)[:80]}")
            return self._json(nexus_tools.run(name, args, self._user()))

        if parsed.path == "/api/chat":
            prompt = str(body.get("prompt", "")).strip()
            if not prompt:
                return self._json({"ok": False, "error": "empty prompt"}, 400)
            user = self._user()
            channel = str(body.get("channel", ""))
            model = str(body.get("model", ""))
            mode = str(body.get("mode", "chat"))
            print(f"  {mode:<7} {channel or providers.default_channel(user):<12} "
                  f"{'(' + user + ')' if user else '(guest)':<10} {prompt[:50]}")
            out = providers.ask(prompt, channel, model, user=user, mode=mode)
            if not out.get("ok"):
                print(f"          -> {out.get('error')}")
            return self._json(out, 200 if out.get("ok") else 502)

        return self._json({"ok": False, "error": "no such endpoint"}, 404)


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def open_in(browser: str, url: str) -> None:
    if browser == "comet":
        for exe in COMET_CANDIDATES:
            if exe.exists():
                subprocess.Popen([str(exe), "--new-window", url])
                return
        print("Comet not found; falling back to the default browser")
    webbrowser.open(url)


def main() -> int:
    ap = argparse.ArgumentParser(description="Serve the HYBRID AGENT site over localhost")
    ap.add_argument("--dir", default=str(DEFAULT_DIR), help="folder to serve")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--browser", default="default", choices=("default", "comet", "none"))
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()

    root = Path(a.dir).resolve()
    if not (root / "index.html").exists():
        sys.exit(f"No index.html in {root}. Pass --dir <folder>.")

    port = a.port
    while not port_free(port) and port < a.port + 20:
        print(f"port {port} is busy, trying {port + 1}")
        port += 1

    handler = functools.partial(QuietHandler, directory=str(root))

    # Threaded on purpose: a single-request-at-a-time server wedges the whole
    # console the moment one connection stalls, and the browser keeps several
    # open. Daemon threads so ctrl-c still exits.
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    bind_host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    with Server((bind_host, port), handler) as httpd:
        url = f"http://localhost:{port}/index.html"
        print(f"HYBRID AGENT serving {root}")
        print(f"  {url}")
        print(f"  http://hybrid.localhost:{port}/")
        print(f"  {url.replace('index.html', 'console.html')}")
        print("ctrl-c to stop")

        if not a.no_open and a.browser != "none":
            threading.Thread(
                target=lambda: (time.sleep(0.4), open_in(a.browser, url)),
                daemon=True,
            ).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
