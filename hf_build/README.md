---
title: Hybrid Agent
emoji: ✋
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
