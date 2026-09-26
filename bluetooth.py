"""
HYBRID AGENT - Bluetooth
========================

Reads the Bluetooth radio, lists paired devices with their live connected
state, and asks Windows to connect or drop one.

    python bluetooth.py                 # radio + paired devices
    python bluetooth.py on              # turn the radio on
    python bluetooth.py off             # turn it off
    python bluetooth.py connect jbl     # connect a paired device
    python bluetooth.py disconnect jbl
    python bluetooth.py pane            # open the Windows Bluetooth settings

What Windows actually allows
----------------------------
Reading state and toggling the radio are documented WinRT calls and work
unprivileged. *Connecting an already-paired device* is not exposed that
cleanly: this asks the OS to open the device's services, which is what makes
Windows bring the link up, then re-reads the connected flag and reports what
really happened. A device that is switched off or out of range cannot be
connected by any amount of software, so `connect` says so rather than
claiming success. `pane` always works as the manual fallback.

Nothing here pairs a new device - pairing needs a PIN the user confirms, and
that belongs in Windows' own dialog, not in this script.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys

TIMEOUT = 30

# ---------------------------------------------------------------- PowerShell

# The WinRT boilerplate every block needs: PowerShell 5.1 has no await, so an
# IAsyncOperation is turned into a Task through the one AsTask overload.
PRELUDE = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                 $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } |
  Select-Object -First 1
function Await($op, $type, $ms = 15000) {
  $task = $AsTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'the Bluetooth stack did not answer in time' }
  $task.Result
}
function Radios {
  [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
        ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}
function BtRadio { Radios | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1 }

# {83DA6326-...} 15 is DEVPKEY_Device_IsConnected - the live link state, not
# just whether the pairing exists.
$CONNECTED = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'

function PairedDevices {
  Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -match '^BTHENUM\\DEV_|^BTHLE\\DEV_' } |
    ForEach-Object {
      $flag = $null
      try { $flag = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $CONNECTED -ErrorAction Stop).Data } catch {}
      $addr = ''
      if ($_.InstanceId -match 'DEV_([0-9A-Fa-f]{12})') { $addr = $Matches[1].ToUpper() }
      [PSCustomObject]@{
        name      = $_.FriendlyName
        address   = $addr
        le        = [bool]($_.InstanceId -like 'BTHLE\*')
        connected = [bool]$flag
        status    = $_.Status
      }
    }
}
"""


def run_ps(body: str) -> dict:
    """Run a PowerShell block that prints one JSON object on its last line."""
    script = PRELUDE + "\n" + body
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True, text=True, timeout=TIMEOUT,
        )
    except FileNotFoundError:
        return {"ok": False, "error": "PowerShell not found - this needs Windows"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Bluetooth query timed out"}

    out = (proc.stdout or "").strip()
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                break
    err = (proc.stderr or "").strip().splitlines()
    return {"ok": False, "error": err[0] if err else (out or "no answer from PowerShell")}


# ---------------------------------------------------------------- the model

def slug(name: str) -> str:
    """A stable key for a device name: "Guru's JBL Clip 5" -> "guru-s-jbl-clip-5"."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "device"


def kind_of(name: str, le: bool) -> str:
    n = name.lower()
    if any(w in n for w in ("headphone", "headset", "buds", "speaker", "jbl", "boat",
                            "airpod", "soundbar", "audio")):
        return "audio"
    if any(w in n for w in ("mouse", "keyboard", "trackpad", "pen", "controller", "gamepad")):
        return "input"
    if any(w in n for w in ("phone", "oppo", "redmi", "iphone", "galaxy", "vivo",
                            "oneplus", "pixel", "realme", "samsung", "xiaomi")):
        return "phone"
    return "le" if le else "device"


def devices() -> dict:
    """Every paired device Windows can see, deduplicated by address."""
    res = run_ps("""
$rows = @(PairedDevices)
@{ ok = $true; devices = $rows } | ConvertTo-Json -Compress -Depth 4
""")
    if not res.get("ok"):
        return res

    rows = res.get("devices") or []
    if isinstance(rows, dict):                      # ConvertTo-Json unwraps a single row
        rows = [rows]

    merged: dict[str, dict] = {}
    for r in rows:
        addr = r.get("address") or ""
        name = r.get("name") or "Unknown"
        entry = merged.get(addr)
        if entry is None:
            entry = {
                "key": slug(name), "name": name, "address": addr,
                "kind": kind_of(name, bool(r.get("le"))),
                "le": bool(r.get("le")), "connected": bool(r.get("connected")),
            }
            merged[addr] = entry
        else:
            # one physical device can expose both a classic and an LE node;
            # connected on either node means the device is connected
            entry["connected"] = entry["connected"] or bool(r.get("connected"))
            entry["le"] = entry["le"] and bool(r.get("le"))

    out = sorted(merged.values(), key=lambda d: (not d["connected"], d["name"].lower()))
    # keys must stay unique even if two devices share a name
    seen: dict[str, int] = {}
    for d in out:
        base = d["key"]
        seen[base] = seen.get(base, 0) + 1
        if seen[base] > 1:
            d["key"] = f"{base}-{seen[base]}"
    return {"ok": True, "devices": out}


def radio() -> dict:
    res = run_ps("""
$r = BtRadio
if ($null -eq $r) { @{ ok = $false; error = 'no Bluetooth radio on this machine' } | ConvertTo-Json -Compress }
else { @{ ok = $true; state = "$($r.State)"; name = "$($r.Name)" } | ConvertTo-Json -Compress }
""")
    if res.get("ok"):
        res["on"] = str(res.get("state", "")).lower() == "on"
    return res


def set_radio(on: bool) -> dict:
    want = "On" if on else "Off"
    return run_ps(f"""
$r = BtRadio
if ($null -eq $r) {{ @{{ ok = $false; error = 'no Bluetooth radio on this machine' }} | ConvertTo-Json -Compress; exit }}
$want = [Windows.Devices.Radios.RadioState]::{want}
$res = Await ($r.SetStateAsync($want)) ([Windows.Devices.Radios.RadioAccessStatus]) 10000
Start-Sleep -Milliseconds 400
$now = (BtRadio).State
@{{ ok = ("$res" -eq 'Allowed'); access = "$res"; state = "$now" }} | ConvertTo-Json -Compress
""")


def _find(key: str) -> dict | None:
    listing = devices()
    if not listing.get("ok"):
        return None
    key = key.lower()
    for d in listing["devices"]:
        if key in (d["key"], d["address"].lower()) or key in d["name"].lower():
            return d
    return None


def connect(key: str) -> dict:
    """Ask Windows to bring the link up, then report the real state."""
    dev = _find(key)
    if dev is None:
        return {"ok": False, "error": f"no paired device matching {key!r}. "
                                      f"Run  python bluetooth.py  to list them."}
    if dev["connected"]:
        return {"ok": True, "device": dev, "already": True,
                "note": f"{dev['name']} is already connected"}

    addr = dev["address"]
    le = "true" if dev["le"] else "false"
    res = run_ps(f"""
$addr = [System.Convert]::ToUInt64('{addr}', 16)
$le = ${le}
$err = ''
try {{
  if ($le) {{
    [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    $d = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
    if ($null -ne $d) {{
      # opening GATT with uncached mode is what makes the stack dial out
      $null = Await ($d.GetGattServicesAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult])
    }}
  }} else {{
    [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    $d = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothDevice])
    if ($null -ne $d) {{
      $null = Await ($d.GetRfcommServicesAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)) ([Windows.Devices.Bluetooth.Rfcomm.RfcommDeviceServicesResult])
    }}
  }}
}} catch {{ $err = $_.Exception.Message }}
Start-Sleep -Milliseconds 1500
$row = @(PairedDevices) | Where-Object {{ $_.address -eq '{addr}' -and $_.connected }} | Select-Object -First 1
@{{ ok = [bool]$row; error = $err }} | ConvertTo-Json -Compress
""")

    if res.get("ok"):
        dev["connected"] = True
        return {"ok": True, "device": dev, "note": f"{dev['name']} connected"}

    why = res.get("error") or ""
    return {"ok": False, "device": dev, "needs_pane": True,
            "error": f"{dev['name']} did not come up"
                     + (f" ({why})" if why else "")
                     + ". It is most likely switched off, out of range, or held by "
                       "another device. Turn it on and try again, or use "
                       "'python bluetooth.py pane' and connect it from Windows."}


def disconnect(key: str) -> dict:
    """Windows gives no unprivileged 'drop this link' call, so be honest."""
    dev = _find(key)
    if dev is None:
        return {"ok": False, "error": f"no paired device matching {key!r}"}
    if not dev["connected"]:
        return {"ok": True, "device": dev, "already": True,
                "note": f"{dev['name']} is not connected"}
    return {"ok": False, "device": dev, "needs_pane": True,
            "error": f"Windows does not let an unprivileged app drop {dev['name']}. "
                     f"Turn the radio off ('python bluetooth.py off') or disconnect "
                     f"it from the Bluetooth settings ('python bluetooth.py pane')."}


def pane() -> dict:
    """Open Windows' own Bluetooth page - the fallback that always works."""
    try:
        subprocess.Popen(["cmd", "/c", "start", "", "ms-settings:bluetooth"],
                         shell=False)
        return {"ok": True, "note": "opened Windows Bluetooth settings"}
    except Exception as exc:                        # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def status() -> dict:
    """Everything the console needs in one call."""
    r = radio()
    d = devices()
    return {
        "ok": True,
        "radio": r if r.get("ok") else {"ok": False, "on": False,
                                        "error": r.get("error", "unavailable")},
        "devices": d.get("devices", []) if d.get("ok") else [],
        "error": None if d.get("ok") else d.get("error"),
    }


# ---------------------------------------------------------------- terminal

def show() -> int:
    r = radio()
    if not r.get("ok"):
        print(f"radio: {r.get('error')}")
    else:
        print(f"radio: {r['state'].upper()}")

    d = devices()
    if not d.get("ok"):
        print(f"devices: {d.get('error')}")
        return 1
    if not d["devices"]:
        print("no paired devices")
        return 0

    print()
    for dev in d["devices"]:
        mark = "*" if dev["connected"] else " "
        state = "connected" if dev["connected"] else "idle"
        print(f" {mark} {dev['key']:<20} {dev['name']:<24} {dev['kind']:<7} "
              f"{state:<10} {dev['address']}")
    print("\nconnect with:  python bluetooth.py connect <key>")
    return 0


def main(argv: list[str]) -> int:
    cmd = (argv[0].lower() if argv else "")
    arg = argv[1] if len(argv) > 1 else ""

    if cmd in ("", "list", "status"):
        return show()
    if cmd in ("on", "off"):
        res = set_radio(cmd == "on")
        print(f"radio {res.get('state', cmd).upper()}" if res.get("ok")
              else f"error: {res.get('error') or res.get('access')}")
        return 0 if res.get("ok") else 1
    if cmd == "pane":
        res = pane()
        print(res.get("note") or f"error: {res.get('error')}")
        return 0 if res.get("ok") else 1
    if cmd in ("connect", "disconnect"):
        if not arg:
            print(f"usage: python bluetooth.py {cmd} <key>")
            return 2
        res = connect(arg) if cmd == "connect" else disconnect(arg)
        print(res.get("note") or f"error: {res.get('error')}")
        return 0 if res.get("ok") else 1

    print(__doc__.strip())
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
