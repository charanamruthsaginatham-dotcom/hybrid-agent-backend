"""
HYBRID AGENT - ask a model from the terminal
============================================

    python hybrid_agent.py "summarise what changed today"
    python hybrid_agent.py --model claude "rewrite this as three bullets"
    python hybrid_agent.py --chat                 # stay in a loop
    python hybrid_agent.py --list                 # channels and their state

Whichever channel is default in config.json answers unless --model says otherwise.
Run configure.py first to set keys.
"""

from __future__ import annotations

import argparse
import sys
import time

import providers as P


def one(prompt: str, channel: str, model: str, quiet: bool) -> int:
    t0 = time.time()
    if not quiet:
        target = channel or P.default_channel(P.LOCAL_PROFILE)
        label = P.CHANNELS.get(target, {}).get("label", target)
        print(f"[{label}] thinking…", file=sys.stderr)

    out = P.ask(prompt, channel, model, user=P.LOCAL_PROFILE)
    if not out.get("ok"):
        print(f"error: {out.get('error')}", file=sys.stderr)
        return 1

    print(out["text"])
    if not quiet:
        ms = int((time.time() - t0) * 1000)
        print(f"\n-- {out['label']} · {out['model']} · {ms}ms", file=sys.stderr)
    return 0


def chat(channel: str, model: str) -> int:
    target = channel or P.default_channel()
    print(f"HYBRID AGENT · {P.CHANNELS[target]['label']} · blank line or ctrl-c to leave")
    while True:
        try:
            prompt = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not prompt:
            return 0
        out = P.ask(prompt, target, model)
        print()
        print(out["text"] if out.get("ok") else f"error: {out.get('error')}")


def listing() -> int:
    for row in P.status(P.LOCAL_PROFILE):
        mark = "*" if row["default"] else " "
        state = "ready" if row["has_key"] else "needs a key"
        print(f" {mark} {row['channel']:<8} {row['label']:<18} {state:<12} {row['model']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Ask the configured model")
    ap.add_argument("prompt", nargs="*", help="what to ask")
    ap.add_argument("--model", "-m", default="", help="gemini | claude | ollama")
    ap.add_argument("--name", default="", help="specific model name, e.g. gemma:7b")
    ap.add_argument("--chat", action="store_true", help="interactive loop")
    ap.add_argument("--list", action="store_true", help="show channels")
    ap.add_argument("--quiet", "-q", action="store_true", help="answer only")
    a = ap.parse_args()

    if a.list:
        return listing()
    if a.chat:
        return chat(a.model, a.name)
    if not a.prompt:
        ap.print_help()
        return 2
    return one(" ".join(a.prompt), a.model, a.name, a.quiet)


if __name__ == "__main__":
    raise SystemExit(main())
