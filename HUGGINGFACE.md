# Publish the HYBRID AGENT website

The public website is in `site/`. Hugging Face Spaces can host the static demo
without putting your API keys or computer on a public server.

## Build the public folder first

```powershell
cd "C:\Users\User\Desktop\HYBRID AGENT"
python deploy_hf.py --build-only
```

This creates `hf_build/` with the website and the Hugging Face Space card. It is
generated output and is ignored by Git.

## Publish with the helper

```powershell
python -m pip install huggingface_hub
$env:HF_TOKEN = "hf_YOUR_WRITE_TOKEN"
python deploy_hf.py --user YOUR_HF_USERNAME
```

Alternatively, log in with a current Hugging Face CLI (`hf auth login` or
`huggingface-cli login`) before running the deploy command.

Default Space name: `hybrid-agent`.

- Space page: `https://huggingface.co/spaces/YOUR_HF_USERNAME/hybrid-agent`
- Direct app: `https://your-hf-username-hybrid-agent.static.hf.space`
- Public: omit `--private`
- Unlisted: add `--private`

A Hugging Face account with a **write** token is needed to create or update the
Space. Re-run the deploy command after editing `site/`.

## What the public build includes

| Feature | Public Space | Local `serve.py` |
| --- | --- | --- |
| Camera hand tracking | Yes | Yes |
| In-page gesture cursor | Yes | Yes |
| Gemini / Claude / Ollama replies | Preview only | Yes |
| HTTPS web app links | Yes | Yes |
| Local app launching | No | Yes |
| Bluetooth, serial and ADB tools | No | Yes |
| Native operating-system cursor | No | Yes, via `gesture_mouse.py` |

The console detects when the local bridge is unavailable and labels model
responses as samples instead of pretending they came from a model.

## Camera note

Spaces use HTTPS, so camera access is supported. If the embedded Space preview
blocks camera permission, open the direct `*.static.hf.space` address in a new
tab and allow the camera there.

## Never publish `config.json`

API keys belong only in the local, Git-ignored `config.json`. The deployment
helper copies only `site/`, never the key file or the Python runtime.
