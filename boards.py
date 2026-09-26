"""
HYBRID AGENT - boards, mini computers and phones
================================================

One registry for the hardware around the PC:

  * microcontrollers over USB serial - Arduino, ESP32, Pico, micro:bit, Teensy
  * mini computers over the network   - Raspberry Pi, or any host you name
  * phones over adb                   - USB or wireless debugging

    python boards.py                          # scan everything
    python boards.py send com3 "LED ON"       # one line to a board
    python boards.py monitor com3             # live serial, ctrl-c to stop
    python boards.py add pi 192.168.0.21 --user pi
    python boards.py ping pi
    python boards.py phone                    # adb devices
    python boards.py phone connect 192.168.0.55:5555
    python boards.py mirror                   # scrcpy, if it is installed

Serial needs pyserial (`pip install pyserial`); everything else runs on the
standard library and whatever Windows already has. Saved network devices live
in config.json next to the model keys.

Safety: hosts and ports are validated against a strict pattern and every
external program is run as an argument list, never through a shell. Nothing
here takes a command string from the console.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import providers

HERE = Path(__file__).resolve().parent

# adb ships with scrcpy, the Android SDK, or on PATH - look in all three.
ADB_CANDIDATES = (
    Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
                  "/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe"
                  "/scrcpy-win64-v4.1/adb.exe",
    Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe",
)

HOST_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,62}(:\d{1,5})?$")
PORT_OK = re.compile(r"^COM\d{1,3}$", re.I)

# USB vendor/product prefixes -> what the board actually is. Identifying by
# VID beats trusting the driver's description, which is often just "USB Serial".
VENDORS = {
    "2341": "Arduino", "2A03": "Arduino", "1B4F": "SparkFun",
    "10C4": "ESP32 / CP210x", "1A86": "ESP / CH340", "303A": "ESP32-S",
    "2E8A": "Raspberry Pi Pico", "0D28": "micro:bit", "16C0": "Teensy",
    "239A": "Adafruit", "1366": "Segger", "0403": "FTDI",
}


# ------------------------------------------------------------------ helpers

def adb_path() -> str | None:
    found = shutil.which("adb")
    if found:
        return found
    for c in ADB_CANDIDATES:
        if c.exists():
            return str(c)
    return None


def scrcpy_path() -> str | None:
    found = shutil.which("scrcpy")
    if found:
        return found
    adb = adb_path()
    if adb:
        guess = Path(adb).with_name("scrcpy.exe")
        if guess.exists():
            return str(guess)
    return None


def run(cmd: list[str], timeout: int = 20) -> tuple[int, str]:
    """Run a program as an argument list. No shell, ever."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError:
        return 127, f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def valid_host(host: str) -> bool:
    return bool(HOST_OK.match(host or ""))


def saved() -> dict:
    return providers.load_config().get("devices", {}) or {}


def save_device(key: str, entry: dict) -> None:
    cfg = providers.load_config()
    cfg.setdefault("devices", {})[key] = entry
    providers.save_config(cfg)


def forget_device(key: str) -> bool:
    cfg = providers.load_config()
    if key in (cfg.get("devices") or {}):
        del cfg["devices"][key]
        providers.save_config(cfg)
        return True
    return False


# ------------------------------------------------------------------ serial

def serial_ports() -> list[dict]:
    """Microcontrollers currently plugged in. Empty if pyserial is missing."""
    try:
        from serial.tools import list_ports
    except ImportError:
        return []

    out = []
    for p in list_ports.comports():
        vid = f"{p.vid:04X}" if p.vid is not None else ""
        out.append({
            "key": p.device.lower(),
            "name": VENDORS.get(vid, p.description or "Serial device"),
            "kind": "serial",
            "port": p.device,
            "detail": (p.description or "").strip(),
            "vid": vid,
            "serial": p.serial_number or "",
            "connected": False,        # a port is a link only while open
        })
    return sorted(out, key=lambda d: d["port"])


def serial_available() -> bool:
    try:
        import serial  # noqa: F401
        return True
    except ImportError:
        return False


def serial_send(port: str, line: str, baud: int = 9600, wait: float = 2.0) -> dict:
    """Open the port, send one line, read whatever comes back.

    Opening a port resets most Arduino boards, so the sketch needs a moment to
    boot before it can hear anything - that is what `wait` is for.
    """
    if not PORT_OK.match(port):
        return {"ok": False, "error": f"{port!r} is not a COM port"}
    if not serial_available():
        return {"ok": False, "error": "serial needs pyserial - pip install pyserial"}

    import serial
    try:
        with serial.Serial(port, baud, timeout=1.5) as ser:
            time.sleep(wait)                      # board reset window
            ser.reset_input_buffer()
            if line:
                ser.write((line + "\n").encode("utf-8", "replace"))
                ser.flush()
            deadline = time.time() + 2.5
            chunks = []
            while time.time() < deadline:
                data = ser.readline()
                if not data:
                    break
                chunks.append(data.decode("utf-8", "replace").rstrip())
            return {"ok": True, "port": port, "baud": baud,
                    "reply": [c for c in chunks if c],
                    "note": f"sent to {port} at {baud} baud"}
    except Exception as exc:                      # noqa: BLE001
        return {"ok": False, "error": f"{port}: {exc}"}


def serial_monitor(port: str, baud: int = 9600) -> int:
    if not PORT_OK.match(port):
        print(f"{port!r} is not a COM port")
        return 2
    if not serial_available():
        print("serial needs pyserial - pip install pyserial")
        return 1

    import serial
    try:
        with serial.Serial(port, baud, timeout=1) as ser:
            print(f"{port} @ {baud} - ctrl-c to stop")
            while True:
                data = ser.readline()
                if data:
                    print(data.decode("utf-8", "replace").rstrip())
    except KeyboardInterrupt:
        print("\nstopped")
        return 0
    except Exception as exc:                      # noqa: BLE001
        print(f"{port}: {exc}")
        return 1


# ------------------------------------------------------------------ network

def probe(host: str, port: int, timeout: float = 1.2) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def net_devices() -> list[dict]:
    """Mini computers and Wi-Fi boards you have saved, with live reachability."""
    out = []
    for key, d in saved().items():
        host = d.get("host", "")
        ports = d.get("ports") or [22, 80, 8080]
        live = next((p for p in ports if probe(host, int(p))), None)
        out.append({
            "key": key,
            "name": d.get("name") or key,
            "kind": d.get("kind", "network"),
            "host": host,
            "user": d.get("user", ""),
            "detail": f"{host}" + (f":{live}" if live else ""),
            "connected": live is not None,
            "open_port": live,
        })
    return sorted(out, key=lambda d: (not d["connected"], d["name"].lower()))


def add_device(key: str, host: str, name: str = "", user: str = "",
               kind: str = "network", ports: list[int] | None = None) -> dict:
    key = re.sub(r"[^a-z0-9\-]+", "-", key.lower()).strip("-")
    if not key:
        return {"ok": False, "error": "give the device a short name"}
    if not valid_host(host):
        return {"ok": False, "error": f"{host!r} is not a hostname or IP"}
    entry = {"host": host, "name": name or key, "user": user, "kind": kind,
             "ports": ports or [22, 80, 8080]}
    save_device(key, entry)
    return {"ok": True, "key": key, "device": entry, "note": f"saved {key} -> {host}"}


def ssh_hint(key: str) -> dict:
    d = saved().get(key)
    if not d:
        return {"ok": False, "error": f"no saved device called {key!r}"}
    user = d.get("user") or "pi"
    return {"ok": True, "command": f"ssh {user}@{d['host']}",
            "note": "run this in a terminal - ssh asks for the password itself, "
                    "which is why it is not run from here"}


# ------------------------------------------------------------------ phones

def phones() -> list[dict]:
    """Android devices adb can see, over USB or wireless debugging."""
    adb = adb_path()
    if not adb:
        return []
    code, out = run([adb, "devices", "-l"], timeout=15)
    if code not in (0, 1):
        return []

    rows = []
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices") or line.startswith("*"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        serial_id, state = parts[0], parts[1]
        model = ""
        for p in parts[2:]:
            if p.startswith("model:"):
                model = p.split(":", 1)[1].replace("_", " ")
        rows.append({
            "key": re.sub(r"[^a-z0-9\-.:]+", "-", serial_id.lower()),
            "name": model or serial_id,
            "kind": "phone",
            "detail": serial_id + (" · wireless" if ":" in serial_id else " · usb"),
            "state": state,
            "connected": state == "device",
            "serial": serial_id,
        })
    return rows


def phone_connect(target: str) -> dict:
    """`adb connect host:port` - wireless debugging must already be on."""
    if not valid_host(target):
        return {"ok": False, "error": f"{target!r} is not a host:port"}
    adb = adb_path()
    if not adb:
        return {"ok": False, "error": "adb not found - install scrcpy or platform-tools"}
    if ":" not in target:
        target += ":5555"
    code, out = run([adb, "connect", target], timeout=20)
    ok = "connected to" in out.lower() and "cannot" not in out.lower()
    return {"ok": ok, "note": out.strip().splitlines()[-1] if out.strip() else "",
            "error": None if ok else (out.strip() or f"adb exited {code}")}


def phone_disconnect(target: str = "") -> dict:
    adb = adb_path()
    if not adb:
        return {"ok": False, "error": "adb not found"}
    if target and not valid_host(target):
        return {"ok": False, "error": f"{target!r} is not a host:port"}
    code, out = run([adb, "disconnect"] + ([target] if target else []), timeout=15)
    return {"ok": code == 0, "note": out.strip() or "disconnected",
            "error": None if code == 0 else out.strip()}


def phone_mirror(serial_id: str = "") -> dict:
    """Start scrcpy, which mirrors the screen. It needs an authorised device."""
    exe = scrcpy_path()
    if not exe:
        return {"ok": False, "error": "scrcpy not installed - winget install Genymobile.scrcpy"}
    live = [p for p in phones() if p["connected"]]
    if not live:
        return {"ok": False, "error": "no authorised device - plug the phone in, or "
                                      "turn on wireless debugging and use 'phone connect'"}
    cmd = [exe] + (["-s", serial_id] if serial_id else [])
    try:
        subprocess.Popen(cmd)
    except Exception as exc:                      # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "note": "scrcpy started - the phone screen opens in its own window"}


# ------------------------------------------------------------------ registry

def scan() -> dict:
    """Everything, in one shape the console can render."""
    ports = serial_ports()
    nets = net_devices()
    phs = phones()
    return {
        "ok": True,
        "serial": ports,
        "network": nets,
        "phones": phs,
        "tools": {
            "pyserial": serial_available(),
            "adb": bool(adb_path()),
            "scrcpy": bool(scrcpy_path()),
            "ssh": bool(shutil.which("ssh")),
        },
        "devices": ports + nets + phs,
    }


def find(key: str) -> dict | None:
    key = (key or "").strip().lower()
    if not key:
        return None
    every = scan()["devices"]
    for d in every:
        if d["key"] == key:
            return d
    for d in every:
        if key in d["key"] or key in d["name"].lower():
            return d
    return None


# ------------------------------------------------------------------ terminal

def show() -> int:
    s = scan()
    t = s["tools"]
    print("tools: " + " ".join(
        f"{n}={'yes' if t[n] else 'no'}" for n in ("pyserial", "adb", "scrcpy", "ssh")))

    def block(title: str, rows: list[dict], empty: str) -> None:
        print(f"\n{title}")
        if not rows:
            print(f"  {empty}")
            return
        for d in rows:
            mark = "*" if d["connected"] else " "
            print(f" {mark} {d['key']:<22} {d['name']:<24} {d.get('detail', '')}")

    block("microcontrollers (usb serial)", s["serial"],
          "none plugged in" if t["pyserial"] else "pyserial not installed")
    block("mini computers (network)", s["network"],
          "none saved - python boards.py add pi 192.168.0.21 --user pi")
    block("phones (adb)", s["phones"],
          "none - plug in with USB debugging, or use 'phone connect <ip>'"
          if t["adb"] else "adb not found")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Boards, mini computers and phones",
                                 add_help=True)
    ap.add_argument("cmd", nargs="?", default="scan",
                    help="scan | send | monitor | add | forget | ping | ssh | phone | mirror")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--user", default="")
    ap.add_argument("--name", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    cmd = a.cmd.lower()
    rest = a.args

    if cmd in ("scan", "list"):
        if a.json:
            print(json.dumps(scan(), indent=2))
            return 0
        return show()

    if cmd == "send":
        if len(rest) < 2:
            print('usage: python boards.py send COM3 "LED ON"')
            return 2
        res = serial_send(rest[0].upper(), " ".join(rest[1:]), a.baud)
        if res.get("ok"):
            print(res["note"])
            for line in res["reply"]:
                print("  <", line)
            if not res["reply"]:
                print("  (no reply - fine if the sketch does not answer)")
            return 0
        print(f"error: {res['error']}")
        return 1

    if cmd == "monitor":
        if not rest:
            print("usage: python boards.py monitor COM3 --baud 115200")
            return 2
        return serial_monitor(rest[0].upper(), a.baud)

    if cmd == "add":
        if len(rest) < 2:
            print("usage: python boards.py add pi 192.168.0.21 --user pi")
            return 2
        res = add_device(rest[0], rest[1], a.name, a.user)
        print(res.get("note") or f"error: {res.get('error')}")
        return 0 if res.get("ok") else 1

    if cmd == "forget":
        if not rest:
            print("usage: python boards.py forget pi")
            return 2
        print("forgotten" if forget_device(rest[0].lower()) else "no such device")
        return 0

    if cmd == "ping":
        if not rest:
            print("usage: python boards.py ping pi")
            return 2
        d = find(rest[0])
        if not d:
            print("no such device")
            return 1
        print(f"{d['name']}: {'reachable' if d['connected'] else 'no answer'} "
              f"· {d.get('detail', '')}")
        return 0 if d["connected"] else 1

    if cmd == "ssh":
        if not rest:
            print("usage: python boards.py ssh pi")
            return 2
        res = ssh_hint(rest[0].lower())
        print(res.get("command") or f"error: {res.get('error')}")
        if res.get("ok"):
            print(res["note"])
        return 0 if res.get("ok") else 1

    if cmd == "phone":
        sub = rest[0].lower() if rest else "list"
        if sub == "list":
            rows = phones()
            if not rows:
                print("no phones - plug one in with USB debugging on, or "
                      "'python boards.py phone connect <ip>'")
                return 1
            for p in rows:
                print(f" {'*' if p['connected'] else ' '} {p['name']:<20} "
                      f"{p['state']:<12} {p['detail']}")
            return 0
        if sub == "connect":
            if len(rest) < 2:
                print("usage: python boards.py phone connect 192.168.0.55:5555")
                return 2
            res = phone_connect(rest[1])
            print(res.get("note") or f"error: {res.get('error')}")
            return 0 if res.get("ok") else 1
        if sub == "disconnect":
            res = phone_disconnect(rest[1] if len(rest) > 1 else "")
            print(res.get("note") or f"error: {res.get('error')}")
            return 0 if res.get("ok") else 1
        print("phone: list | connect <ip[:port]> | disconnect")
        return 2

    if cmd == "mirror":
        res = phone_mirror(rest[0] if rest else "")
        print(res.get("note") or f"error: {res.get('error')}")
        return 0 if res.get("ok") else 1

    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
