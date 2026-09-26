"""
HYBRID AGENT - setup
====================

Asks which model channel you want and takes the API key for each one.

    python configure.py                 # walk through every built-in channel
    python configure.py --show          # what is configured (keys stay masked)
    python configure.py --clear claude
    python configure.py --add-llm       # add another OpenAI-compatible endpoint

Keys are written to config.json in this folder and go nowhere else. Type nothing
at a key prompt to leave that channel as it is; type "-" to clear it.

This writes to the local CLI profile - the one account with no password,
because whoever can run this script already has full access to config.json.
The web console's KEYS panel writes to a separate, per-account profile behind
a real sign-in, so a hosted console never answers a visitor with your key.
"""

from __future__ import annotations

import argparse
import getpass
import sys

import providers as P

ME = P.LOCAL_PROFILE


def ask_key(channel: str, spec: dict) -> None:
    current = P.get_key(channel, ME)
    shown = P.mask(current)
    print(f"\n  {spec['label']}")
    if not spec["needs_key"]:
        live = P.ollama_models()
        print(f"    no key needed. {'running, models: ' + ', '.join(live[:4]) if live else 'not running - start it with: ollama serve'}")
        return

    print(f"    key: {shown if current else 'not set'}   get one: {spec['keys_url']}")
    entered = getpass.getpass("    paste key (blank = keep, - = clear): ").strip()
    if not entered:
        return
    if entered == "-":
        P.set_key(channel, "", ME)
        print("    cleared")
        return
    P.set_key(channel, entered, ME)
    print(f"    saved as {P.mask(entered)}")


def pick_model(channel: str, spec: dict) -> None:
    options = list(spec["models"]) or P.ollama_models()
    if not options:
        return
    current = P.get_model(channel, ME)
    print(f"    model [{current}]:")
    for i, m in enumerate(options, 1):
        print(f"      {i}) {m}")
    choice = input("    number (blank = keep): ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(options):
        P.set_model(channel, options[int(choice) - 1], ME)
        print(f"    model set to {options[int(choice) - 1]}")


def pick_default() -> None:
    names = list(P.CHANNELS)
    rows = P.status(ME)
    current = P.default_channel(ME)
    print("\n  Default channel - the one the console and CLI use unless told otherwise.")
    for i, n in enumerate(names, 1):
        ready = "ready" if rows[i - 1]["has_key"] else "no key"
        print(f"    {i}) {P.CHANNELS[n]['label']:<18} {ready}")
    choice = input(f"    number [{current}]: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(names):
        P.set_default(names[int(choice) - 1], ME)
        print(f"    default is now {names[int(choice) - 1]}")


def add_llm() -> int:
    print("\nAdd another model - any OpenAI-chat-completions-compatible endpoint")
    print("(Mistral, Groq, OpenRouter, DeepSeek, Together, a local llama.cpp/LM Studio server...)\n")
    label = input("  name, e.g. Mistral: ").strip()
    base_url = input("  base URL, e.g. https://api.mistral.ai/v1: ").strip()
    model = input("  exact model name, e.g. mistral-large-latest: ").strip()
    key = getpass.getpass("  API key (blank if the endpoint needs none): ").strip()
    res = P.add_custom(ME, label, base_url, key, model)
    if not res.get("ok"):
        print(f"  error: {res.get('error')}")
        return 1
    print(f"  added — use it with  python hybrid_agent.py --model custom:{res['id']} \"...\"")
    return 0


def show() -> int:
    print("\nHYBRID AGENT channels\n")
    for row in P.status(ME):
        flag = "*" if row["default"] else " "
        key = "no key needed" if not row["needs_key"] else (row["masked"] or "NOT SET")
        state = "ready" if row["has_key"] else "not ready"
        tag = row["channel"] if row["custom"] else row["label"]
        print(f" {flag} {tag:<20} {state:<10} {key:<18} model: {row['model']}")
    print(f"\n config: {P.CONFIG_PATH}")
    print(" * = default channel   (this is the local CLI profile; the web console has its own accounts)\n")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Configure HYBRID AGENT model channels")
    ap.add_argument("--show", action="store_true", help="print what is configured")
    ap.add_argument("--clear", metavar="CHANNEL", help="remove a stored key")
    ap.add_argument("--add-llm", action="store_true", help="add another OpenAI-compatible endpoint")
    ap.add_argument("--remove-llm", metavar="ID", help="remove a previously added endpoint")
    a = ap.parse_args()

    if a.add_llm:
        return add_llm()

    if a.remove_llm:
        ok = P.remove_custom(ME, a.remove_llm)
        print("removed" if ok else "no such model")
        return 0 if ok else 1

    if a.clear:
        if a.clear not in P.CHANNELS:
            sys.exit(f"unknown channel: {a.clear}")
        P.set_key(a.clear, "", ME)
        print(f"cleared {a.clear}")
        return 0

    if a.show:
        return show()

    print("HYBRID AGENT setup (local CLI profile)")
    print("Keys are stored in config.json in this folder and are sent only to that provider.")
    for channel, spec in P.CHANNELS.items():
        ask_key(channel, spec)
        pick_model(channel, spec)
    pick_default()
    print()
    return show()


if __name__ == "__main__":
    raise SystemExit(main())
