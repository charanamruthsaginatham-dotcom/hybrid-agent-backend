# HYBRID AGENT — gesture mouse

Two scripts. One drives your real mouse with your hand; the other serves the website.

| File | What it does |
| --- | --- |
| `gesture_mouse.py` | MediaPipe hand tracking → **your actual OS cursor**. Open hand moves, closed fist clicks. |
| `serve.py` | Serves `site/` on localhost so the browser console can use the camera. |

## Install

```
pip install -r requirements.txt
```

Python 3.9–3.12. MediaPipe has no 3.13 wheels yet — check with `python -V`.

## Run the gesture mouse

```
python gesture_mouse.py --self-test    # verify the classifier, no camera needed
python gesture_mouse.py --dry-run      # watch gestures, never touches the mouse
python gesture_mouse.py                # arm it (3 second countdown first)
```

Start with `--dry-run`. It prints every gesture and moves nothing, so you can
check the tracking reads your hand before handing it the cursor.

### Bindings

| Hand | Action |
| --- | --- |
| Open palm | move cursor |
| Point (index only) | move cursor |
| **Closed fist** | **left click** (once per close; cursor frozen while shut) |
| Pinch (thumb + index) | hold left button — drag |
| Victory (index + middle) | right click |
| Thumb up | double click |

### Keys (focus the preview window)

| Key | |
| --- | --- |
| `q` / `ESC` | quit |
| `p` | pause / resume control |
| `[` `]` | gain down / up |
| `-` `=` | smoothing down / up |

### Stopping it if it misbehaves

- Press `q` or `p` in the preview window.
- `Ctrl-C` in the terminal.
- Slam your physical mouse into a screen corner — that trips pyautogui's failsafe
  (non-Windows backend). On Windows the ctypes backend has no failsafe, so keep
  the preview window reachable.

### Options

```
--camera 1        pick a different camera
--gain 2.2        more screen travel per hand movement (default 1.7)
--smoothing 0.5   snappier, jitterier (default 0.32; lower is smoother)
--pinch 0.32      tighter pinch threshold
--cooldown 0.5    minimum seconds between clicks
--no-preview      no camera window (then only Ctrl-C stops it)
--start-paused    launch with control disengaged
```

## Serve the website

```
python serve.py                  # http://localhost:8790, opens your browser
python serve.py --browser comet  # open in Comet
python serve.py --port 9000
```

Camera permission is refused on `file://` pages, so serve the folder rather than
double-clicking `index.html`.

## How it decides what your hand is doing

No `.task` model download — MediaPipe's bundled hand model gives 21 landmarks,
and `classify()` turns those into a gesture with plain geometry:

- **Finger extended**: the fingertip is further from the wrist than its own
  middle joint. Distance-based, so it holds whichever way your hand is rotated.
- **Hand span**: wrist → middle knuckle. Every other measure is divided by it,
  so thresholds hold whether your hand is near the lens or far from it.
- **Pinch**: thumb tip to index tip under 0.38 spans — *and the index extended*.
  Without that second condition a closed fist reads as a pinch, because a folded
  thumb rests right against the curled index tip.
- **Cursor anchor**: the middle-finger knuckle, i.e. the palm centre. A fingertip
  anchor would drag the pointer as your hand closes, so clicks would land late
  and low.

`--self-test` runs these rules against synthetic hands and checks the palm anchor
does not drift between an open hand and a fist.

## Known limits

- Tracking is 2D. Moving your hand toward or away from the camera changes the
  apparent span; the ratios absorb most of that, but very close to the lens the
  classifier gets twitchy.
- One hand, by design (`max_num_hands=1`). A second hand in frame is ignored.
- Windows-first: the ctypes backend is the default there. Elsewhere it uses
  pyautogui, which is a little slower per move.
