# HYBRID AGENT

Everything from the HYBRID AGENT project in one folder: the gesture console, the
native gesture mouse, the app launcher, and a model router that talks to
**Gemini, Claude or your local Ollama** — whichever you give it a key for.

## Quick start

```
cd "C:\Users\User\Desktop\HYBRID AGENT"
python configure.py          # pick a channel, paste its API key
python serve.py              # console at http://localhost:8790
```

Ollama needs no key. If `ollama serve` is running, the console works immediately.

## Accounts — why a key isn't shared with every visitor

The console needs a sign-in before a Gemini or Claude key answers a prompt.
Without that, the first key anyone stored would quietly answer *every* visitor
who opened the console — fine on your own machine, wrong the moment this is
hosted, shared over a LAN, or opened by anyone else.

So: **Local Ollama needs no key and works for anyone**, signed in or not — it's
a local model with no secret to protect. **Gemini, Claude, and anything you add
under ADD LLM belong to an account.** Sign in from the **OPR** chip (username +
password; the password is hashed with PBKDF2-SHA256 before it touches disk,
never stored as plain text), and only your own stored keys answer your prompts.
Sign out, or let someone else open the console, and those channels go back to
"sign in to use this."

Sessions are a random token in memory on the bridge, handed to the browser as
an `httpOnly` cookie — nothing about a session is ever written to disk, and a
bridge restart signs everyone out. This is separate from the terminal tools
below, which already run as whoever has a shell on this machine.

## Choosing a model and giving it a key

Three ways, all writing to the same `config.json` in this folder:

| Where | How |
| --- | --- |
| Terminal | `python configure.py` — walks every channel, key input is masked |
| Console | sign in (**OPR** chip), then the **KEYS** chip — pick a channel, paste the key, choose the model |
| Environment | set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` — only the terminal tools use these, never a web account |

Get keys at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
[console.anthropic.com](https://console.anthropic.com/settings/keys).

`python configure.py --show` prints what is configured; keys stay masked.
`python configure.py --clear claude` removes one.

### Adding another model — the ADD LLM button

Any endpoint that speaks the OpenAI chat-completions format works: Mistral,
Groq, OpenRouter, DeepSeek, Together, or a local llama.cpp / LM Studio server.

```
python configure.py --add-llm
python configure.py --remove-llm mistral
```

Or in the console: sign in, open **KEYS**, **+ ADD LLM** — name, base URL
(e.g. `https://api.mistral.ai/v1`), the exact model name, and a key if the
endpoint needs one. It shows up under **YOUR MODELS**, scoped to your account
like any other key.

### Where keys go

`config.json`, in this folder, on this machine — each account's keys under its
own entry, never one shared place every visitor draws from. They are sent to
that provider and nowhere else — never printed to the terminal, never written
to the log, never echoed back to the page. The console never holds a key: it
posts your prompt to the local bridge, and the bridge attaches your key.

The one exception is `__local__`, a reserved account with no password: it's
what the terminal tools (`configure.py`, `hybrid_agent.py`) use, because
whoever can run those already has full filesystem access to `config.json` — a
CLI password would be theatre, not security. It can never be reached by
signing in from the web.

**Do not commit `config.json`.** `.gitignore` already excludes it.

## Asking a model

```
python hybrid_agent.py "summarise what changed today"
python hybrid_agent.py --model claude "rewrite this as three bullets"
python hybrid_agent.py --model ollama --name gemma:7b "explain this error"
python hybrid_agent.py --chat
python hybrid_agent.py --list
```

Or type into the console's prompt and press EXECUTE — same router.

## Gestures

```
python gesture_mouse.py --self-test    # classifier check, no camera
python gesture_mouse.py --dry-run      # watch gestures, mouse untouched
python gesture_mouse.py                # drives the real OS cursor
```

Open hand moves · closed fist clicks · pinch drags · victory right-clicks ·
thumb up double-clicks. `q` quits, `p` pauses. Details in
`README_gesture_mouse.md`.

In the **browser** console the same gestures move a cursor *inside the page* and
click its controls. Only `gesture_mouse.py` moves the operating system pointer.

## Bluetooth

```
python bluetooth.py                 # radio state + every paired device
python bluetooth.py on              # radio on / off
python bluetooth.py connect jbl     # bring a paired device up
python bluetooth.py pane            # Windows' own Bluetooth settings
```

In the console: the **BT** chip in the header, or type `bt`, `bt on`,
`bt connect jbl` into the prompt.

Reading the radio and toggling it are documented Windows calls and work without
admin rights. *Connecting* a paired device is not exposed that cleanly: the
script asks Windows to open the device's services, which is what raises the
link, then re-reads the connected flag and reports the truth. A device that is
off or out of range cannot be reached by any software, and you get that as the
answer instead of a false success. Pairing something new stays in the Windows
dialog, because it asks you to confirm a PIN.

## Launching apps

The console's **APPS** panel, or `open <app>` in the prompt. Everything opens as
an https web app except WhatsApp, which opens the desktop client via
`whatsapp://`. Local apps (Notepad, Explorer, Terminal) need `serve.py` running.

```
python apps.py               # list the registry
python apps.py whatsapp      # launch one
```

## Boards, mini computers and phones

```
python boards.py                        # scan serial, network and phones
python boards.py send com3 "LED ON"     # one line to a microcontroller
python boards.py monitor com3 --baud 115200
python boards.py add pi 192.168.0.21 --user pi
python boards.py ping pi
python boards.py phone                  # adb devices
python boards.py phone connect 192.168.0.55:5555
python boards.py mirror                 # scrcpy, if installed
```

In the console: the **DEV** chip, or `dev`, `dev send com3 LED ON`,
`dev add pi 192.168.0.21`, `dev phone 192.168.0.55`, `dev mirror`.

| Family | How it connects | Needs |
| --- | --- | --- |
| Arduino, ESP32, Pico, micro:bit | USB serial, identified by USB vendor ID | `pip install pyserial` |
| Raspberry Pi, any host you save | TCP reachability, then `ssh` you run yourself | nothing |
| Android phones | `adb` over USB or wireless debugging | adb (ships with scrcpy) |

Phones also appear in the **BT** panel once paired over Bluetooth; `adb` is the
route when you want the phone as a *device* rather than as audio.

SSH is printed for you to run, never executed here: it asks for a password, and
this console does not handle passwords. Hosts and ports are validated before
they reach any program, and nothing is run through a shell.

## Files

| | |
| --- | --- |
| `providers.py` | the model router — Gemini, Claude, Ollama, custom LLMs, per account |
| `auth.py` | accounts — hashed passwords, sessions, the `__local__` CLI profile |
| `configure.py` | interactive setup for channels and keys |
| `hybrid_agent.py` | ask a model from the terminal |
| `serve.py` | serves `site/` + the local bridge (`/api/chat`, `/api/key`, `/api/open`, `/api/bt`, `/api/dev`, `/api/auth/*`, `/api/llm/*`) |
| `apps.py` | the app allowlist and launcher |
| `bluetooth.py` | radio, paired devices, connect |
| `boards.py` | serial boards, network hosts, adb phones |
| `gesture_mouse.py` | MediaPipe hand tracking → real OS cursor |
| `deploy_hf.py` | publish `site/` as a Hugging Face Space |
| `site/` | the website: landing page + A.D.A console |
| `config.json` | your channels and keys (created on first save) |

## What is real and what is not

- **Real**: hand tracking, the in-page cursor and fist click, the OS cursor in
  `gesture_mouse.py`, app launching, and model replies once a channel is ready.
- **Simulated**: model replies when no bridge is running or no key is stored.
  The console labels these `sample reply` with the reason, so you always know.

## No bridge, no keys

`serve.py` is what makes keys and local apps work. Opening `site/index.html`
directly, or hosting it on Hugging Face, still gives you gestures and https apps —
the console detects the missing bridge and says so rather than pretending.

## Requirements

```
pip install -r requirements.txt
```

Only the gesture mouse needs those (mediapipe, opencv). The model router and the
server run on the standard library alone.
