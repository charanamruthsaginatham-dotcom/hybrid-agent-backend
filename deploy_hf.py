"""
HYBRID AGENT - deploy the public website to Hugging Face Spaces
================================================================

Builds a static Space from ``site/`` and uploads it.

    python -m pip install huggingface_hub
    hf auth login                         # or set HF_TOKEN

    python deploy_hf.py --build-only      # assemble ./hf_build only
    python deploy_hf.py --user YOURNAME   # create the Space and upload
    python deploy_hf.py --user YOURNAME --space hybrid-agent

Why static: a remote Space cannot run programs on a visitor's computer. The
public build therefore keeps browser-safe gesture controls and web links, while
``python serve.py`` unlocks real model, app, Bluetooth and hardware actions.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = next(
    (candidate for candidate in (HERE / "site", HERE.parent / "site")
     if (candidate / "index.html").exists()),
    HERE / "site",
)
BUILD = HERE / "hf_build"
INCLUDE = ("index.html", "console.html", "favicon.svg", "robots.txt", "css", "js")

CARD = """---
title: Hybrid Agent
emoji: \N{RAISED HAND}
colorFrom: blue
colorTo: green
sdk: static
app_file: index.html
pinned: false
short_description: Gesture-controlled local AI for models, apps and connected devices.
---

# HYBRID AGENT

A local-first agent workspace that connects natural hand gestures to useful
machine actions.

## Public demo

- MediaPipe hand tracking in the browser
- In-page cursor movement, click and drag controls
- Gemini, Claude and Ollama route preview
- Safe links to web applications

Open the console, allow the camera, and enable **Gesture Matrix**.

## Run the full agent locally

```bash
python -m pip install -r requirements.txt
python configure.py
python serve.py
```

The local bridge adds real model replies, an allow-listed app launcher,
Bluetooth tools, serial/network device support, and the native gesture mouse.

## Privacy

Camera frames are processed in the visitor's browser and are not uploaded. API
keys remain in the local ``config.json`` file, which is excluded by Git.
"""


def build() -> Path:
    if not (SITE / "index.html").exists():
        sys.exit(f"No public site found at {SITE}")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)

    for name in INCLUDE:
        source = SITE / name
        if not source.exists():
            sys.exit(f"Missing public-site file: {source}")
        destination = BUILD / name
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)

    (BUILD / "README.md").write_text(CARD, encoding="utf-8")

    files = sorted(
        path.relative_to(BUILD).as_posix()
        for path in BUILD.rglob("*")
        if path.is_file()
    )
    print(f"Built public Space: {BUILD}")
    for filename in files:
        print(f"  {filename}")
    return BUILD


def push(user: str, space: str, private: bool, message: str) -> int:
    try:
        from huggingface_hub import HfApi
    except ImportError:
        sys.exit("Install the uploader first: python -m pip install huggingface_hub")

    token = os.environ.get("HF_TOKEN")
    api = HfApi(token=token)

    try:
        account = api.whoami()
    except Exception as exc:
        sys.exit(
            "Hugging Face login required. Run `hf auth login` or set "
            f"HF_TOKEN to a write token. ({exc})"
        )

    user = user or account.get("name", "")
    if not user:
        sys.exit("Could not determine your Hugging Face username. Pass --user.")

    repo_id = f"{user}/{space}"
    print(f"Uploading to {repo_id} as {account.get('name', user)}")

    api.create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk="static",
        private=private,
        exist_ok=True,
    )
    api.upload_folder(
        folder_path=str(BUILD),
        repo_id=repo_id,
        repo_type="space",
        commit_message=message,
    )

    print("\nPublic Space:")
    print(f"  https://huggingface.co/spaces/{repo_id}")
    print(f"  https://{user.lower()}-{space.lower()}.static.hf.space")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deploy the Hybrid Agent website to a Hugging Face Space"
    )
    parser.add_argument("--user", default="", help="your Hugging Face username")
    parser.add_argument(
        "--space", default="hybrid-agent", help="Space name (default: hybrid-agent)"
    )
    parser.add_argument("--private", action="store_true", help="keep the Space unlisted")
    parser.add_argument(
        "--message", default="Deploy Hybrid Agent public website"
    )
    parser.add_argument(
        "--build-only", action="store_true", help="assemble hf_build and stop"
    )
    args = parser.parse_args()

    build()
    if args.build_only:
        print("\nBuild complete. To push manually:")
        print(f"  cd {BUILD}")
        print("  git init")
        print("  git add -A")
        print("  git commit -m \"Hybrid Agent website\"")
        print(
            "  git remote add origin "
            f"https://huggingface.co/spaces/<user>/{args.space}"
        )
        print("  git push -u origin main")
        return 0

    return push(args.user, args.space, args.private, args.message)


if __name__ == "__main__":
    raise SystemExit(main())
