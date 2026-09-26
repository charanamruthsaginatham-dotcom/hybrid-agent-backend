"""
HYBRID AGENT - gesture mouse
======================

Drives the real operating-system cursor with your hand, using the same bindings
as the A.D.A web console:

    open hand    -> move the cursor (anchored to the palm centre)
    closed fist  -> left click, once per close, cursor frozen while shut
    pinch        -> hold left button down (drag)
    victory      -> right click
    thumb up     -> double click

Run:
    python gesture_mouse.py                 # arm it
    python gesture_mouse.py --dry-run       # watch the gestures, never touch the mouse
    python gesture_mouse.py --self-test     # verify the classifier, no camera needed

Controls while running (focus the preview window):
    q / ESC   quit          p   pause or resume control
    [  ]      gain down/up  -/= smoothing down/up

Safety: slam your physical mouse into a screen corner, or press q, to stop.
"""

from __future__ import annotations

import argparse
import math
import platform
import sys
import time
from dataclasses import dataclass

# Landmark indices from MediaPipe's 21-point hand model.
WRIST = 0
THUMB_TIP = 4
INDEX_MCP, INDEX_PIP, INDEX_TIP = 5, 6, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP = 9, 10, 12
RING_PIP, RING_TIP = 14, 16
PINKY_MCP, PINKY_PIP, PINKY_TIP = 17, 18, 20

FINGERS = ((INDEX_PIP, INDEX_TIP), (MIDDLE_PIP, MIDDLE_TIP),
           (RING_PIP, RING_TIP), (PINKY_PIP, PINKY_TIP))

# gesture -> what the desktop should do
ACTIONS = {
    "OPEN_PALM": "CURSOR_MOVE",
    "POINTING_UP": "CURSOR_MOVE",
    "CLOSED_FIST": "CLICK",
    "PINCH": "DRAG",
    "VICTORY": "RIGHT_CLICK",
    "THUMB_UP": "DOUBLE_CLICK",
    "THUMB_DOWN": "CANCEL",
    "NONE": "IDLE",
}


@dataclass
class Config:
    gain: float = 1.7          # hand travel -> screen travel multiplier
    smoothing: float = 0.32    # 0 = frozen, 1 = no smoothing at all
    pinch_ratio: float = 0.38  # thumb-index distance over hand span
    click_cooldown: float = 0.7
    camera: int = 0
    width: int = 960
    height: int = 540
    preview: bool = True
    dry_run: bool = False
    start_paused: bool = False


# --------------------------------------------------------------------------
# geometry - pure functions over [(x, y), ...] in 0..1 image space,
# so the whole classifier is testable without a camera or mediapipe.
# --------------------------------------------------------------------------

def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def hand_span(lm) -> float:
    """Wrist to middle knuckle: a scale reference that holds at any distance."""
    return max(dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-6)


def finger_extended(lm, pip: int, tip: int) -> bool:
    """Rotation-invariant: an extended fingertip sits further from the wrist
    than its own middle joint, whichever way the hand is turned."""
    return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.12


def thumb_extended(lm) -> bool:
    """Tucked against the fist the thumb tip sits ~0.15 spans from the index
    knuckle; thrown out for a thumbs-up it reaches ~0.5. Split the difference."""
    return dist(lm[THUMB_TIP], lm[INDEX_MCP]) > hand_span(lm) * 0.40


def pinch_ratio(lm) -> float:
    return dist(lm[THUMB_TIP], lm[INDEX_TIP]) / hand_span(lm)


def classify(lm, cfg: Config) -> str:
    """Map 21 landmarks onto one of the console's gesture labels."""
    if len(lm) < 21:
        return "NONE"

    up = [finger_extended(lm, pip, tip) for pip, tip in FINGERS]
    count = sum(up)
    thumb = thumb_extended(lm)

    # A pinch is the thumb meeting an EXTENDED index finger. Without that guard
    # a closed fist reads as a pinch, because a folded thumb naturally rests
    # against the curled index tip.
    if up[0] and count <= 2 and pinch_ratio(lm) < cfg.pinch_ratio:
        return "PINCH"
    if count == 0:
        return "CLOSED_FIST" if not thumb else (
            "THUMB_UP" if lm[THUMB_TIP][1] < lm[WRIST][1] else "THUMB_DOWN"
        )
    if count == 4:
        return "OPEN_PALM"
    if up[0] and not up[1] and not up[2] and not up[3]:
        return "POINTING_UP"
    if up[0] and up[1] and not up[2] and not up[3]:
        return "VICTORY"
    return "NONE"


def clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def to_screen(lm, cfg: Config, screen_w: int, screen_h: int):
    """Palm centre -> screen pixel. The palm, not a fingertip, so closing the
    hand to click cannot drag the pointer off target."""
    px, py = lm[MIDDLE_MCP]
    nx = clamp01(0.5 + (px - 0.5) * cfg.gain)
    ny = clamp01(0.5 + (py - 0.5) * cfg.gain)
    # keep a pixel off every edge: the corners arm pyautogui's failsafe
    x = min(max(int(nx * screen_w), 1), screen_w - 2)
    y = min(max(int(ny * screen_h), 1), screen_h - 2)
    return x, y


# --------------------------------------------------------------------------
# mouse backends
# --------------------------------------------------------------------------

class DryRun:
    name = "dry-run"

    def __init__(self):
        import shutil  # noqa: F401  (only to prove stdlib import works)
        self.size = (1920, 1080)

    def move(self, x, y): pass
    def down(self): print("  [dry-run] mouse down")
    def up(self): print("  [dry-run] mouse up")
    def click(self): print("  [dry-run] left click")
    def right_click(self): print("  [dry-run] right click")
    def double_click(self): print("  [dry-run] double click")


class Win32:
    """ctypes straight to user32 - no extra dependency, lowest latency."""
    name = "win32"
    MOVE, LEFTDOWN, LEFTUP = 0x0001, 0x0002, 0x0004
    RIGHTDOWN, RIGHTUP = 0x0008, 0x0010

    def __init__(self):
        import ctypes
        self.u = ctypes.windll.user32
        self.size = (self.u.GetSystemMetrics(0), self.u.GetSystemMetrics(1))

    def move(self, x, y): self.u.SetCursorPos(int(x), int(y))
    def down(self): self.u.mouse_event(self.LEFTDOWN, 0, 0, 0, 0)
    def up(self): self.u.mouse_event(self.LEFTUP, 0, 0, 0, 0)

    def click(self):
        self.down(); time.sleep(0.01); self.up()

    def right_click(self):
        self.u.mouse_event(self.RIGHTDOWN, 0, 0, 0, 0)
        time.sleep(0.01)
        self.u.mouse_event(self.RIGHTUP, 0, 0, 0, 0)

    def double_click(self):
        self.click(); time.sleep(0.08); self.click()


class PyAutoGui:
    name = "pyautogui"

    def __init__(self):
        import pyautogui
        pyautogui.PAUSE = 0
        pyautogui.FAILSAFE = True
        self.p = pyautogui
        self.size = pyautogui.size()

    def move(self, x, y): self.p.moveTo(x, y, _pause=False)
    def down(self): self.p.mouseDown()
    def up(self): self.p.mouseUp()
    def click(self): self.p.click()
    def right_click(self): self.p.click(button="right")
    def double_click(self): self.p.doubleClick()


def pick_backend(cfg: Config):
    if cfg.dry_run:
        return DryRun()
    if platform.system() == "Windows":
        try:
            return Win32()
        except Exception as exc:                       # pragma: no cover
            print(f"win32 backend unavailable ({exc}); trying pyautogui")
    try:
        return PyAutoGui()
    except ImportError:
        sys.exit("No mouse backend. Install pyautogui:  pip install pyautogui")


# --------------------------------------------------------------------------
# main loop
# --------------------------------------------------------------------------

def run(cfg: Config) -> int:
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        sys.exit(f"Missing dependency ({exc.name}). Run:  pip install -r requirements.txt")

    mouse = pick_backend(cfg)
    screen_w, screen_h = mouse.size

    cap = cv2.VideoCapture(cfg.camera, cv2.CAP_DSHOW if platform.system() == "Windows" else 0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.height)
    if not cap.isOpened():
        sys.exit(f"Camera {cfg.camera} would not open. Try --camera 1, or close whatever is using it.")

    hands = mp.solutions.hands.Hands(
        model_complexity=0,          # fastest of the bundled models
        max_num_hands=1,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
    )
    drawer, styles = mp.solutions.drawing_utils, mp.solutions.drawing_styles

    print(f"HYBRID AGENT gesture mouse | backend={mouse.name} | screen={screen_w}x{screen_h}")
    print("open hand moves | fist clicks | pinch drags | q quits | p pauses")
    if not cfg.dry_run and not cfg.start_paused:
        for n in (3, 2, 1):
            print(f"  arming in {n}...", end="\r", flush=True)
            time.sleep(1)
        print("  armed. move your palm.     ")

    paused = cfg.start_paused
    cur_x, cur_y = screen_w / 2, screen_h / 2
    gesture = "NONE"
    last_click = 0.0
    dragging = False
    fps, last_t = 0.0, time.time()

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("dropped frame"); continue

            frame = cv2.flip(frame, 1)                  # mirror: move right, go right
            h, w = frame.shape[:2]
            result = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

            gesture, action = "NONE", "IDLE"
            if result.multi_hand_landmarks:
                hand = result.multi_hand_landmarks[0]
                lm = [(p.x, p.y) for p in hand.landmark]
                gesture = classify(lm, cfg)
                action = ACTIONS.get(gesture, "IDLE")
                now = time.time()

                # a shut hand clicks; hold the cursor still while it is shut
                if gesture not in ("CLOSED_FIST", "PINCH"):
                    tx, ty = to_screen(lm, cfg, screen_w, screen_h)
                    cur_x += (tx - cur_x) * cfg.smoothing
                    cur_y += (ty - cur_y) * cfg.smoothing
                    if not paused:
                        mouse.move(cur_x, cur_y)

                if gesture == "PINCH":
                    if not dragging and not paused:
                        mouse.down(); dragging = True
                elif dragging:
                    if not paused:
                        mouse.up()
                    dragging = False

                if gesture in ("CLOSED_FIST", "VICTORY", "THUMB_UP") \
                        and now - last_click > cfg.click_cooldown:
                    last_click = now
                    if not paused:
                        {"CLOSED_FIST": mouse.click,
                         "VICTORY": mouse.right_click,
                         "THUMB_UP": mouse.double_click}[gesture]()
                    print(f"{time.strftime('%H:%M:%S')}  {gesture:<12} -> {action}")

                if cfg.preview:
                    drawer.draw_landmarks(
                        frame, hand, mp.solutions.hands.HAND_CONNECTIONS,
                        styles.get_default_hand_landmarks_style(),
                        styles.get_default_hand_connections_style())
            elif dragging:
                if not paused:
                    mouse.up()
                dragging = False

            t = time.time()
            fps = 0.9 * fps + 0.1 / max(t - last_t, 1e-6)
            last_t = t

            if cfg.preview:
                state = "PAUSED" if paused else ("DRY RUN" if cfg.dry_run else "ARMED")
                colour = (60, 160, 255) if paused else (255, 240, 0)
                cv2.rectangle(frame, (0, 0), (w, 96), (10, 7, 5), -1)
                cv2.putText(frame, f"HYBRID AGENT  {state}", (14, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, colour, 2)
                cv2.putText(frame, f"{gesture} -> {action}", (14, 58),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (158, 255, 57), 2)
                cv2.putText(frame,
                            f"pos {int(cur_x)},{int(cur_y)}   gain {cfg.gain:.2f}   "
                            f"smooth {cfg.smoothing:.2f}   {fps:4.1f} fps",
                            (14, 84), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
                cv2.imshow("HYBRID AGENT gesture mouse", frame)

                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    break
                if key == ord("p"):
                    paused = not paused
                    if dragging and paused:
                        mouse.up(); dragging = False
                    print("paused" if paused else "resumed")
                if key == ord("["):
                    cfg.gain = max(0.5, cfg.gain - 0.1)
                if key == ord("]"):
                    cfg.gain = min(4.0, cfg.gain + 0.1)
                if key == ord("-"):
                    cfg.smoothing = max(0.05, cfg.smoothing - 0.03)
                if key in (ord("="), ord("+")):
                    cfg.smoothing = min(1.0, cfg.smoothing + 0.03)
    except KeyboardInterrupt:
        pass
    finally:
        if dragging:
            mouse.up()
        cap.release()
        hands.close()
        if cfg.preview:
            cv2.destroyAllWindows()
    print("stopped")
    return 0


# --------------------------------------------------------------------------
# self test - synthetic hands, no camera and no mediapipe required
# --------------------------------------------------------------------------

def _hand(curl=(True, True, True, True), thumb_out=False, thumb_up=True, pinch=False):
    """Build a plausible 21-point hand. curl[i] True means that finger is folded."""
    lm = [(0.5, 0.9)] * 21
    lm[WRIST] = (0.50, 0.90)
    lm[INDEX_MCP] = (0.44, 0.62)
    lm[MIDDLE_MCP] = (0.50, 0.60)
    lm[PINKY_MCP] = (0.60, 0.64)

    thumb_y = 0.62 if thumb_up else 0.98
    lm[THUMB_TIP] = (0.30, thumb_y) if thumb_out else (0.46, 0.66)

    cols = (0.40, 0.48, 0.56, 0.63)
    for i, (pip, tip) in enumerate(FINGERS):
        lm[pip] = (cols[i], 0.52)
        lm[tip] = (cols[i], 0.58) if curl[i] else (cols[i], 0.30)

    if pinch:                      # thumb tip meets index tip
        lm[THUMB_TIP] = lm[INDEX_TIP]
    return lm


def self_test() -> int:
    cfg = Config()
    cases = [
        ("open palm",   _hand(curl=(False, False, False, False)),            "OPEN_PALM"),
        ("closed fist", _hand(),                                            "CLOSED_FIST"),
        ("point",       _hand(curl=(False, True, True, True)),              "POINTING_UP"),
        ("victory",     _hand(curl=(False, False, True, True)),             "VICTORY"),
        ("thumb up",    _hand(thumb_out=True, thumb_up=True),               "THUMB_UP"),
        ("thumb down",  _hand(thumb_out=True, thumb_up=False),              "THUMB_DOWN"),
        ("pinch",       _hand(curl=(False, True, True, True), pinch=True),  "PINCH"),
    ]
    ok = True
    for name, lm, want in cases:
        got = classify(lm, cfg)
        flag = "ok  " if got == want else "FAIL"
        if got != want:
            ok = False
        print(f"  {flag} {name:<12} expected {want:<12} got {got}")

    # the palm anchor must not move when the fingers fold
    open_pt = to_screen(_hand(curl=(False,) * 4), cfg, 1920, 1080)
    fist_pt = to_screen(_hand(), cfg, 1920, 1080)
    drift = math.dist(open_pt, fist_pt)
    stable = drift < 2
    print(f"  {'ok  ' if stable else 'FAIL'} palm anchor  open{open_pt} fist{fist_pt} drift={drift:.1f}px")
    ok = ok and stable

    print("\nself test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    p = argparse.ArgumentParser(description="HYBRID AGENT - drive the OS cursor with your hand")
    p.add_argument("--camera", type=int, default=0, help="camera index (default 0)")
    p.add_argument("--gain", type=float, default=1.7, help="hand travel multiplier")
    p.add_argument("--smoothing", type=float, default=0.32, help="0..1, lower is smoother")
    p.add_argument("--pinch", type=float, default=0.38, help="pinch threshold")
    p.add_argument("--cooldown", type=float, default=0.7, help="seconds between clicks")
    p.add_argument("--no-preview", action="store_true", help="run without the camera window")
    p.add_argument("--dry-run", action="store_true", help="report gestures, never move the mouse")
    p.add_argument("--start-paused", action="store_true", help="start with control disengaged")
    p.add_argument("--self-test", action="store_true", help="check the classifier and exit")
    a = p.parse_args()

    if a.self_test:
        return self_test()

    return run(Config(
        gain=a.gain, smoothing=a.smoothing, pinch_ratio=a.pinch,
        click_cooldown=a.cooldown, camera=a.camera,
        preview=not a.no_preview, dry_run=a.dry_run, start_paused=a.start_paused,
    ))


if __name__ == "__main__":
    raise SystemExit(main())
