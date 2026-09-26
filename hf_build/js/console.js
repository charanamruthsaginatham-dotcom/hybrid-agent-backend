/* HYBRID AGENT - A.D.A console runtime: MediaPipe gestures, reactor, telemetry, terminal. */
(function(){
"use strict";
var $ = function(s){ return document.querySelector(s); };
var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- model registry ---------------- */
var MODELS = {
  gemini:{ label:"Google Gemini", short:"GEMINI", build:"gemini-2.5-pro", accent:"#00f0ff", rgb:"0,240,255",
    link:"LINKED", vram:"2.4GB", ctx:"4.1k",
    replies:[
      "Directive parsed. Vision pipeline is warm \u2014 I can map the desktop into nine interaction zones and bind each one to a pinch target.",
      "Understood. I would stage that as three steps: capture, classify, then dispatch to the window manager. Say the word and I will rehearse it dry.",
      "Indexed 1,204 desktop entities. The window you are describing sits on workspace 2 \u2014 want me to pull it forward?"
    ]},
  claude:{ label:"Anthropic Claude", short:"CLAUDE", build:"claude-opus-5", accent:"#a05cff", rgb:"160,92,255",
    link:"LINKED", vram:"1.8GB", ctx:"12.8k",
    replies:[
      "Got it. Before I touch anything irreversible I will show you the plan: two file moves, one rename, nothing deleted. Confirm and I will run it.",
      "Doable, but that binding collides with FIST \u2192 DRAG_LOCK. I would remap it to PEACE instead. Want me to rewrite the binding?",
      "Reading the directive literally: you want the summary, not the raw log. Drafting it now \u2014 four lines, no jargon."
    ]},
  ollama:{ label:"Local Ollama", short:"OLLAMA", build:"llama3.2:8b-instruct", accent:"#39ff9e", rgb:"57,255,158",
    link:"LOCAL", vram:"6.1GB", ctx:"8.0k",
    replies:[
      "Running fully offline. No packets left this machine \u2014 inference is on the local GPU at 62 tokens per second.",
      "Loaded llama3.2:8b-instruct from disk in 0.9s. Ask away; nothing here is billed and nothing is logged upstream.",
      "Local model, smaller window, so I will keep it tight: arm the gesture matrix first, then the air keyboard has a cursor to follow."
    ]}
};

var S = {
  model:"gemini", camera:false, gesture:false, airkb:false, voice:false, talking:false,
  busy:false, pos:[960,540], gestureLabel:"NONE", action:"IDLE", load:12, tok:0,
  amp:0, kbBuf:"", start:Date.now(), lines:0
};

/* ---------------- terminal ---------------- */
var term = $("#term"), logCount = $("#log-count");
var TAGS = {sys:"[SYS]", ok:"[OK ]", warn:"[WRN]", err:"[ERR]", user:"[YOU]", model:"[MDL]"};
function stamp(){
  var d = new Date();
  function p(n,l){ return String(n).padStart(l||2,"0"); }
  return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())+"."+p(d.getMilliseconds(),3);
}
function log(msg, kind, tag){
  kind = kind || "sys";
  var ln = document.createElement("div");
  ln.className = "ln " + kind;
  var t = document.createElement("time"); t.textContent = stamp();
  var g = document.createElement("span"); g.className = "tag"; g.textContent = tag || TAGS[kind] || TAGS.sys;
  var m = document.createElement("span"); m.className = "msg"; m.textContent = msg;
  ln.appendChild(t); ln.appendChild(g); ln.appendChild(m);
  term.appendChild(ln);
  while(term.children.length > 220) term.removeChild(term.firstChild);
  S.lines++; logCount.textContent = S.lines + " LINES";
  term.scrollTop = term.scrollHeight;
  return m;
}
function stream(msg, kind, tag){
  var el = log("", kind, tag);
  if(reduced){ el.textContent = msg; return Promise.resolve(); }
  var caret = document.createElement("span"); caret.className = "caret";
  el.parentNode.appendChild(caret);
  return new Promise(function(res){
    var i = 0;
    var id = setInterval(function(){
      i = Math.min(msg.length, i + Math.ceil(Math.random()*3) + 1);
      el.textContent = msg.slice(0, i);
      term.scrollTop = term.scrollHeight;
      if(i >= msg.length){ clearInterval(id); caret.remove(); res(); }
    }, 16);
  });
}

/* ---------------- telemetry ---------------- */
function setTel(id, value){ document.querySelector(id + " .v").textContent = value; }
function setAction(a){ S.action = a; setTel("#t-action", a); }
function setGesture(g){ S.gestureLabel = g; setTel("#t-gesture", g); }
function setPos(x, y){
  S.pos = [x,y];
  setTel("#t-pos", "X " + String(Math.round(x)).padStart(4,"0") + " \u00b7 Y " + String(Math.round(y)).padStart(4,"0"));
}
function setStatus(s, color){
  setTel("#t-status", s);
  $("#t-status").style.setProperty("--tc", color);
}
function pill(id, text, color, live){
  var el = $(id);
  el.querySelector("b").textContent = text;
  el.style.setProperty("--st", color);
  el.classList.toggle("live", !!live);
}

/* ---------------- model switching ---------------- */
function applyModel(key, announce){
  var m = MODELS[key]; S.model = key;
  document.documentElement.style.setProperty("--accent", m.accent);
  document.documentElement.style.setProperty("--accent-rgb", m.rgb);
  var btns = document.querySelectorAll(".seg button");
  for(var i=0;i<btns.length;i++) btns[i].setAttribute("aria-pressed", String(btns[i].dataset.model === key));
  $("#core-model").textContent = m.short;
  $("#lg-vram").textContent = m.vram;
  $("#lg-ctx").textContent = m.ctx;
  pill("#pill-api", m.link, m.accent, true);
  if(announce){
    log("Switching inference channel \u2192 " + m.label, "sys");
    log("Handshake ok \u00b7 " + m.build + " \u00b7 ctx " + m.ctx + " \u00b7 " + (key === "ollama" ? "offline, weights on local disk" : "encrypted transport"), "ok");
    chatPill("channel \u2192 " + m.label, "ok");
    setAction("MODEL_SWAP");
    setTimeout(function(){ setAction(S.busy ? "GENERATING" : (S.gesture ? S.action : "IDLE")); }, 900);
  }
}
Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function(b){
  b.addEventListener("click", function(){ if(b.dataset.model !== S.model) applyModel(b.dataset.model, true); });
});

/* ---------------- shared canvas helpers ---------------- */
function accent(){
  return (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#00f0ff").trim();
}
function rgba(hex, a){
  var h = hex.replace("#","");
  if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  var n = parseInt(h, 16);
  return "rgba(" + ((n>>16)&255) + "," + ((n>>8)&255) + "," + (n&255) + "," + a + ")";
}
var VIOLET = "#7000ff";

/* ---------------- reactor ---------------- */
var rc = $("#reactor"), rx = rc.getContext("2d"), RW = 0, RH = 0;
function sizeReactor(){
  var r = rc.getBoundingClientRect();
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  RW = r.width; RH = r.height;
  rc.width = Math.max(1, Math.round(r.width * dpr));
  rc.height = Math.max(1, Math.round(r.height * dpr));
  rx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function ring(cx, cy, r, from, to, w, color, glow){
  rx.beginPath(); rx.arc(cx, cy, r, from, to);
  rx.lineWidth = w; rx.strokeStyle = color; rx.lineCap = "round";
  rx.shadowBlur = glow || 0; rx.shadowColor = color;
  rx.stroke(); rx.shadowBlur = 0;
}
function drawReactor(t){
  if(!RW || !RH) return;
  rx.clearRect(0, 0, RW, RH);
  var cx = RW/2, cy = RH/2, R = Math.min(RW, RH)/2 - 6, A = accent();
  var energy = (S.talking?0.5:0) + (S.voice?0.25:0) + (S.busy?0.4:0) + (S.gesture?0.15:0);
  var pulse = reduced ? 0.5 : (Math.sin(t/520)*0.5 + 0.5);

  var g = rx.createRadialGradient(cx, cy, R*0.06, cx, cy, R);
  g.addColorStop(0, rgba(A, 0.30 + energy*0.28));
  g.addColorStop(0.45, rgba(A, 0.06));
  g.addColorStop(1, "rgba(0,0,0,0)");
  rx.fillStyle = g; rx.beginPath(); rx.arc(cx, cy, R, 0, Math.PI*2); rx.fill();

  ring(cx, cy, R*0.99, 0, Math.PI*2, 1, rgba(A, 0.16));
  for(var i=0;i<6;i++){
    var a0 = t/5200 + i*Math.PI/3;
    ring(cx, cy, R*0.955, a0, a0 + 0.36, 2.2, rgba(A, 0.85), 14);
  }

  rx.save(); rx.setLineDash([3, 9]);
  ring(cx, cy, R*0.88, -t/3400, -t/3400 + Math.PI*2, 1.4, rgba(A, 0.5));
  rx.restore();

  var span = Math.PI*1.55, sweep = (S.load/100)*span;
  ring(cx, cy, R*0.80, -Math.PI/2 + sweep, -Math.PI/2 + span, 4, rgba(A, 0.10));
  ring(cx, cy, R*0.80, -Math.PI/2, -Math.PI/2 + sweep, 4, rgba(A, 0.9), 18);

  for(var k=0;k<72;k++){
    var a = (k/72)*Math.PI*2 + t/22000;
    var long = (k % 6 === 0);
    var r1 = R*0.71, r2 = R*(long ? 0.63 : 0.67);
    rx.beginPath();
    rx.moveTo(cx + Math.cos(a)*r1, cy + Math.sin(a)*r1);
    rx.lineTo(cx + Math.cos(a)*r2, cy + Math.sin(a)*r2);
    rx.lineWidth = long ? 1.6 : 1;
    rx.strokeStyle = rgba(A, long ? 0.55 : 0.2);
    rx.stroke();
  }

  rx.save(); rx.setLineDash([22, 16]);
  ring(cx, cy, R*0.56, t/2600, t/2600 + Math.PI*2, 2.4, rgba(VIOLET, 0.75), 16);
  rx.restore();

  for(var q=0;q<2;q++){
    var rot = (q ? -1 : 1)*t/4200 + q*Math.PI/3;
    rx.beginPath();
    for(var v=0;v<3;v++){
      var av = rot + v*Math.PI*2/3, rv = R*0.44;
      var x = cx + Math.cos(av)*rv, y = cy + Math.sin(av)*rv;
      if(v) rx.lineTo(x, y); else rx.moveTo(x, y);
    }
    rx.closePath();
    rx.lineWidth = 1; rx.strokeStyle = rgba(q ? VIOLET : A, 0.35); rx.stroke();
  }

  var cr = R*(0.26 + pulse*0.02 + energy*0.05);
  var cg = rx.createRadialGradient(cx, cy, 0, cx, cy, cr);
  cg.addColorStop(0, "rgba(255,255,255,.85)");
  cg.addColorStop(0.25, rgba(A, 0.65 + energy*0.25));
  cg.addColorStop(0.7, rgba(VIOLET, 0.28));
  cg.addColorStop(1, "rgba(0,0,0,0)");
  rx.fillStyle = cg; rx.beginPath(); rx.arc(cx, cy, cr, 0, Math.PI*2); rx.fill();
  ring(cx, cy, R*0.30, 0, Math.PI*2, 1.2, rgba(A, 0.5 + energy*0.3), 12);

  var nodes = 3 + (S.gesture?2:0) + (S.busy?2:0);
  for(var n=0;n<nodes;n++){
    var an = t/1500*((n%2)?-1:1) + n*Math.PI*2/nodes;
    var rn = R*(0.80 - (n%3)*0.11);
    var nx = cx + Math.cos(an)*rn, ny = cy + Math.sin(an)*rn;
    var nc = (n%2) ? VIOLET : A;
    rx.beginPath(); rx.arc(nx, ny, 2.4, 0, Math.PI*2);
    rx.fillStyle = rgba(nc, 0.95); rx.shadowBlur = 12; rx.shadowColor = rgba(nc, 1);
    rx.fill(); rx.shadowBlur = 0;
  }
}

/* ---------------- MediaPipe hand tracking ---------------- */
var MP_SRC   = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
var MP_MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
var HAND_LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
                  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
/* MediaPipe canonical gesture -> desktop command */
var MP_ACTIONS = {
  CLOSED_FIST:"CLICK", OPEN_PALM:"CURSOR_MOVE", POINTING_UP:"CURSOR_MOVE",
  THUMB_UP:"CONFIRM", THUMB_DOWN:"CANCEL", VICTORY:"SCREENSHOT",
  ILOVEYOU:"VOICE_TOGGLE", PINCH:"MOUSE_DOWN", NONE:"IDLE"
};
var MP = {
  video:$("#feed"), lib:null, recognizer:null, loading:null,
  mode:"sim", stream:null, results:null, lastTs:-1, lastLabel:"NONE", lastLogged:0, fail:false
};

function withTimeout(promise, ms, what){
  return new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){
      if(!done){ done = true; reject(new Error(what + " timed out after " + Math.round(ms/1000) + "s")); }
    }, ms);
    promise.then(function(v){ if(!done){ done = true; clearTimeout(timer); resolve(v); } },
                 function(e){ if(!done){ done = true; clearTimeout(timer); reject(e); } });
  });
}

function buildRecognizer(fileset, delegate){
  return MP.lib.GestureRecognizer.createFromOptions(fileset, {
    baseOptions:{ modelAssetPath:MP_MODEL, delegate:delegate },
    runningMode:"VIDEO",
    numHands:1,
    minHandDetectionConfidence:0.5,
    minTrackingConfidence:0.5
  });
}

function loadRecognizer(){
  if(MP.recognizer) return Promise.resolve(MP.recognizer);
  if(MP.loading) return MP.loading;
  log("Loading MediaPipe tasks-vision 0.10.14 \u00b7 gesture_recognizer float16", "sys", "[MPP]");
  MP.loading = withTimeout(import(MP_SRC), 20000, "module fetch")
    .then(function(lib){
      MP.lib = lib;
      return withTimeout(lib.FilesetResolver.forVisionTasks(MP_SRC + "/wasm"), 25000, "wasm fetch");
    })
    .then(function(fileset){
      /* GPU delegate first; some machines and sandboxes only do CPU */
      return withTimeout(buildRecognizer(fileset, "GPU"), 30000, "model download").catch(function(err){
        log("GPU delegate failed (" + (err && err.message ? err.message : err) + ") \u00b7 retrying on CPU", "warn", "[MPP]");
        return withTimeout(buildRecognizer(fileset, "CPU"), 30000, "model download");
      });
    })
    .then(function(rec){
      MP.recognizer = rec;
      log("Recognizer ready \u00b7 21-point mesh \u00b7 7 canonical gestures + derived pinch", "ok", "[MPP]");
      return rec;
    })
    .catch(function(err){
      MP.loading = null; MP.fail = true;
      log("MediaPipe unavailable: " + (err && err.message ? err.message : err), "err", "[MPP]");
      throw err;
    });
  return MP.loading;
}

function startCamera(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    MP.mode = "sim";
    log("No camera API in this context \u2014 synthetic feed engaged", "warn");
    return Promise.resolve("sim");
  }
  return navigator.mediaDevices.getUserMedia({ video:{ width:{ideal:640}, height:{ideal:400}, facingMode:"user" }, audio:false })
    .then(function(stream){
      MP.stream = stream;
      MP.video.srcObject = stream;
      return MP.video.play().then(function(){
        MP.mode = "live";
        var track = stream.getVideoTracks()[0];
        var set = track.getSettings ? track.getSettings() : {};
        var w = set.width || 640, h = set.height || 400;
        cam.width = w; cam.height = h;
        $("#cam-res").textContent = w + "\u00d7" + h + " \u00b7 " + Math.round(set.frameRate || 30) + "FPS";
        log("Optical feed live \u00b7 " + (track.label || "camera 0") + " \u00b7 " + w + "\u00d7" + h, "ok");
        return "live";
      });
    })
    .catch(function(err){
      MP.mode = "sim";
      log("Camera blocked (" + (err && err.name ? err.name : "error") + ") \u2014 synthetic feed engaged", "warn");
      return "sim";
    });
}

function stopCamera(){
  if(MP.stream){
    MP.stream.getTracks().forEach(function(t){ t.stop(); });
    MP.stream = null; MP.video.srcObject = null;
  }
  MP.mode = "sim"; MP.results = null; MP.lastTs = -1; MP.lastLabel = "NONE";
  cursorShow(false);
  cam.width = 640; cam.height = 400;
}

/* pinch = thumb tip to index tip, normalised by hand span */
function pinchRatio(lm){
  var dx = lm[4].x - lm[8].x, dy = lm[4].y - lm[8].y;
  var sx = lm[0].x - lm[9].x, sy = lm[0].y - lm[9].y;
  var span = Math.sqrt(sx*sx + sy*sy) || 0.001;
  return Math.sqrt(dx*dx + dy*dy) / span;
}

function readGestures(now){
  if(!MP.recognizer || MP.mode !== "live") return;
  var v = MP.video;
  if(!v.videoWidth || v.currentTime === MP.lastTs) return;
  MP.lastTs = v.currentTime;
  try{ MP.results = MP.recognizer.recognizeForVideo(v, now); }
  catch(e){ return; }

  var res = MP.results, label = "NONE", conf = 0;
  if(res && res.landmarks && res.landmarks.length){
    var lm = res.landmarks[0];
    if(res.gestures && res.gestures.length && res.gestures[0].length){
      label = String(res.gestures[0][0].categoryName || "NONE").toUpperCase();
      conf = res.gestures[0][0].score || 0;
    }
    /* A pinch is the thumb meeting an extended index finger. Never override a
       closed fist: a folded thumb rests against the curled index tip, which
       would otherwise read as a pinch and swallow the click. */
    if(label !== "CLOSED_FIST" && pinchRatio(lm) < 0.38){ label = "PINCH"; conf = Math.max(conf, 0.9); }
    /* closed hand first: it decides whether this frame moves the cursor or clicks */
    cursorGrip(label === "CLOSED_FIST" && conf > 0.55);
    cursorTrack(lm);
  }else{
    cursorGrip(false);
  }

  if(label !== MP.lastLabel && now - MP.lastLogged > 260){
    MP.lastLabel = label; MP.lastLogged = now;
    var action = MP_ACTIONS[label] || "IDLE";
    setGesture(label);
    if(!S.busy) setAction(action);
    if(label !== "NONE"){
      log("gesture=" + label + " conf=" + conf.toFixed(2) + " \u2192 dispatch " + action, "sys", "[GST]");
    }
  }
}

/* ---------------- optical feed rendering ---------------- */
var cam = $("#cam"), cc = cam.getContext("2d");
var handX = 0.5, handY = 0.5, handVX = 0.004, handVY = 0.003;
function drawCam(t){
  var W = cam.width, H = cam.height, A = accent(), i;
  cc.fillStyle = "#04070b"; cc.fillRect(0, 0, W, H);
  cc.strokeStyle = rgba(A, 0.10); cc.lineWidth = 1;
  for(i=0;i<=W;i+=32){ cc.beginPath(); cc.moveTo(i, 0); cc.lineTo(i, H); cc.stroke(); }
  for(i=0;i<=H;i+=32){ cc.beginPath(); cc.moveTo(0, i); cc.lineTo(W, i); cc.stroke(); }
  for(i=0;i<140;i++){
    cc.fillStyle = rgba(A, Math.random()*0.06);
    cc.fillRect(Math.random()*W, Math.random()*H, 2, 2);
  }
  var sy = (t/9) % H;
  var grad = cc.createLinearGradient(0, sy-40, 0, sy+2);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, rgba(A, 0.20));
  cc.fillStyle = grad; cc.fillRect(0, sy-40, W, 42);

  handX += handVX; handY += handVY;
  if(handX < 0.18 || handX > 0.82) handVX *= -1;
  if(handY < 0.22 || handY > 0.78) handVY *= -1;
  var bx = handX*W, by = handY*H, bw = W*0.20, bh = H*0.26, c = 14;
  cc.strokeStyle = rgba(A, 0.9); cc.lineWidth = 2;
  var corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
  for(i=0;i<4;i++){
    var sx = corners[i][0], sv = corners[i][1];
    var px = bx + sx*bw/2, py = by + sv*bh/2;
    cc.beginPath(); cc.moveTo(px - sx*c, py); cc.lineTo(px, py); cc.lineTo(px, py - sv*c); cc.stroke();
  }
  cc.strokeStyle = rgba(VIOLET, 0.85); cc.lineWidth = 1.4;
  for(var f=0;f<5;f++){
    var a = -Math.PI/2 + (f-2)*0.34 + Math.sin(t/700 + f)*0.05;
    var len = bh*(f === 0 ? 0.30 : 0.42), oy = by + bh*0.22;
    cc.beginPath();
    cc.moveTo(bx, oy);
    cc.lineTo(bx + Math.cos(a)*len*0.6, oy + Math.sin(a)*len*0.6);
    cc.lineTo(bx + Math.cos(a)*len, oy + Math.sin(a)*len);
    cc.stroke();
    cc.fillStyle = rgba(A, 0.9);
    cc.beginPath(); cc.arc(bx + Math.cos(a)*len, oy + Math.sin(a)*len, 2.6, 0, Math.PI*2); cc.fill();
  }
  cc.font = "500 11px 'JetBrains Mono', monospace";
  cc.fillStyle = rgba(A, 0.95);
  cc.fillText("HAND_01 \u00b7 " + (S.gesture ? S.gestureLabel : "TRACKING") + " \u00b7 0.9" + (2 + Math.floor(Math.random()*7)), bx - bw/2, by - bh/2 - 8);

  if(S.gesture) setPos(handX*1920, handY*1080);
}

function drawCamLive(t){
  var W = cam.width, H = cam.height, A = accent(), i;
  if(MP.video.readyState < 2){
    cc.fillStyle = "#04070b"; cc.fillRect(0, 0, W, H);
    cc.font = "500 11px 'JetBrains Mono', monospace";
    cc.fillStyle = rgba(A, 0.7); cc.fillText("OPENING DEVICE", 12, 20);
    return;
  }
  cc.save();
  cc.translate(W, 0); cc.scale(-1, 1);            /* mirror: a HUD you can steer */
  cc.drawImage(MP.video, 0, 0, W, H);
  cc.restore();

  /* pull the frame into the console palette */
  cc.fillStyle = "rgba(4,7,11,.45)"; cc.fillRect(0, 0, W, H);
  cc.globalCompositeOperation = "overlay";
  cc.fillStyle = rgba(A, 0.10); cc.fillRect(0, 0, W, H);
  cc.globalCompositeOperation = "source-over";

  cc.strokeStyle = rgba(A, 0.07); cc.lineWidth = 1;
  for(i=0;i<=W;i+=Math.round(W/20)){ cc.beginPath(); cc.moveTo(i,0); cc.lineTo(i,H); cc.stroke(); }
  for(i=0;i<=H;i+=Math.round(H/12)){ cc.beginPath(); cc.moveTo(0,i); cc.lineTo(W,i); cc.stroke(); }

  var res = MP.results;
  if(!res || !res.landmarks || !res.landmarks.length){
    cc.font = "500 11px 'JetBrains Mono', monospace";
    cc.fillStyle = rgba(A, 0.75);
    cc.fillText(S.gesture ? "SEARCHING FOR HAND" : "TRACKING IDLE \u00b7 ARM GESTURE MATRIX", 12, 20);
    return;
  }

  var lm = res.landmarks[0], k;
  var px = function(pt){ return [(1 - pt.x)*W, pt.y*H]; };

  cc.strokeStyle = rgba(VIOLET, 0.9); cc.lineWidth = 2;
  for(k=0;k<HAND_LINKS.length;k++){
    var a = px(lm[HAND_LINKS[k][0]]), b = px(lm[HAND_LINKS[k][1]]);
    cc.beginPath(); cc.moveTo(a[0], a[1]); cc.lineTo(b[0], b[1]); cc.stroke();
  }
  for(k=0;k<lm.length;k++){
    var q = px(lm[k]);
    var tip = (k===4||k===8||k===12||k===16||k===20);
    cc.beginPath(); cc.arc(q[0], q[1], tip ? 4 : 2.4, 0, Math.PI*2);
    cc.fillStyle = rgba(A, tip ? 1 : 0.7);
    cc.shadowBlur = tip ? 10 : 0; cc.shadowColor = rgba(A, 1);
    cc.fill(); cc.shadowBlur = 0;
  }

  var xs = lm.map(function(pt){ return (1-pt.x)*W; }), ys = lm.map(function(pt){ return pt.y*H; });
  var x0 = Math.min.apply(null, xs)-14, x1 = Math.max.apply(null, xs)+14;
  var y0 = Math.min.apply(null, ys)-14, y1 = Math.max.apply(null, ys)+14;
  cc.strokeStyle = rgba(A, 0.95); cc.lineWidth = 2;
  var c = 16, corners = [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]];
  for(k=0;k<4;k++){
    var cn = corners[k];
    cc.beginPath();
    cc.moveTo(cn[0] + cn[2]*c, cn[1]); cc.lineTo(cn[0], cn[1]); cc.lineTo(cn[0], cn[1] + cn[3]*c);
    cc.stroke();
  }
  var conf = (res.gestures && res.gestures.length && res.gestures[0].length) ? res.gestures[0][0].score : 0;
  cc.font = "500 11px 'JetBrains Mono', monospace";
  cc.fillStyle = rgba(A, 0.95);
  cc.fillText("HAND_01 \u00b7 " + MP.lastLabel + " \u00b7 " + conf.toFixed(2), Math.max(6, x0), Math.max(14, y0 - 8));
}

/* ---------------- voice meter ---------------- */
var meter = $("#meter"), bars = [];
for(var b=0;b<28;b++){ var sp = document.createElement("span"); meter.appendChild(sp); bars.push(sp); }
function drawMeter(t){
  var active = S.talking || S.voice;
  for(var i=0;i<bars.length;i++){
    var h = 2;
    if(active){
      var base = S.talking ? 22 : 9;
      h = 2 + Math.abs(Math.sin(t/(120 + i*11) + i))*base*(0.4 + S.amp*0.6);
    }
    bars[i].style.height = h.toFixed(1) + "px";
    bars[i].style.opacity = active ? String(0.55 + Math.min(h/26, 1)*0.45) : "0.25";
  }
}

/* ---------------- controls ---------------- */
function toggleBtn(el, on){
  el.setAttribute("aria-pressed", String(on));
  var st = el.querySelector(".state");
  if(st) st.textContent = on ? "ON" : "OFF";
}
function restAction(){ return S.busy ? "GENERATING" : (S.gesture ? S.action : "IDLE"); }

$("#btn-cam").addEventListener("click", function(){
  S.camera = !S.camera;
  toggleBtn($("#btn-cam"), S.camera);
  $("#camoff").style.display = S.camera ? "none" : "grid";
  $("#camtag").hidden = !S.camera;
  if(S.camera){
    log("Requesting optical device \u00b7 awaiting browser permission", "sys");
    setAction("CAM_STREAM");
    pill("#pill-cam", "OPENING", "#ffb020", true);
    $("#camtag-text").textContent = "OPENING";
    startCamera().then(function(mode){
      if(!S.camera){ stopCamera(); return; }
      var live = (mode === "live");
      $("#camtag").classList.toggle("live", live);
      $("#camtag-text").textContent = live ? "REC \u00b7 LIVE" : "REC \u00b7 SIMULATED";
      if(!live) $("#cam-res").textContent = "640\u00d7400 \u00b7 SIM";
      pill("#pill-cam", live ? "STREAMING" : "SIM FEED", live ? "#39ff9e" : "#ffb020", true);
      if(live && S.gesture) toggleGesture(true);
    });
  }else{
    stopCamera();
    $("#cam-res").textContent = "\u2014";
    $("#camtag").classList.remove("live");
    pill("#pill-cam", "OFFLINE", "#5d7488", false);
    log("Optical feed released \u00b7 device closed", "warn");
    if(S.gesture) toggleGesture(false); else setAction(restAction());
  }
});

var GESTURES = [
  ["OPEN_PALM","HOVER_IDLE"], ["PINCH","MOUSE_DOWN"], ["POINT","CURSOR_MOVE"],
  ["FIST","DRAG_LOCK"], ["PEACE","SCREENSHOT"], ["SWIPE_LEFT","WORKSPACE_PREV"],
  ["SWIPE_RIGHT","WORKSPACE_NEXT"], ["THUMB_UP","CONFIRM"]
];
var gestureTimer = null;
function synthGestures(){
  clearInterval(gestureTimer);
  gestureTimer = setInterval(function(){
    var pick = GESTURES[Math.floor(Math.random()*GESTURES.length)];
    setGesture(pick[0]);
    if(!S.busy) setAction(pick[1]);
    log("gesture=" + pick[0] + " conf=0." + (84 + Math.floor(Math.random()*15)) + " \u2192 " + pick[1] + " (synthetic)", "sys", "[GST]");
  }, 2200);
}
function toggleGesture(on){
  S.gesture = on;
  toggleBtn($("#btn-gesture"), on);
  clearInterval(gestureTimer); gestureTimer = null;
  if(on){
    if(MP.mode === "live" && !MP.fail){
      log("Gesture matrix arming \u00b7 MediaPipe hand landmarker", "ok");
      loadRecognizer().then(function(){
        if(S.gesture) log("Matrix hot \u00b7 show a hand to the camera", "ok", "[GST]");
      }).catch(function(){
        if(S.gesture){ log("Falling back to synthetic gesture stream", "warn", "[GST]"); synthGestures(); }
      });
      return;
    }
    log("Gesture matrix armed \u00b7 synthetic stream (no live camera)", "warn");
    gestureTimer = setInterval(function(){
      var pick = GESTURES[Math.floor(Math.random()*GESTURES.length)];
      setGesture(pick[0]);
      if(!S.busy) setAction(pick[1]);
      log("gesture=" + pick[0] + " conf=0." + (84 + Math.floor(Math.random()*15)) + " \u2192 dispatch " + pick[1], "sys", "[GST]");
    }, 2200);
  }else{
    MP.results = null; MP.lastLabel = "NONE";
    cursorShow(false);
    setGesture("NONE");
    setAction(S.busy ? "GENERATING" : "IDLE");
    log("Gesture matrix disarmed", "warn");
  }
}
$("#btn-gesture").addEventListener("click", function(){
  if(!S.gesture && !S.camera){
    log("Gesture matrix needs the optical feed \u2014 starting camera first", "warn");
    $("#btn-cam").click();
  }
  toggleGesture(!S.gesture);
});

/* air keyboard */
Array.prototype.forEach.call(document.querySelectorAll(".kbrow"), function(row){
  row.dataset.keys.split("").forEach(function(k){
    var d = document.createElement("div");
    d.className = "key"; d.textContent = k; d.dataset.k = k;
    row.appendChild(d);
  });
});
var kbTimer = null;
$("#btn-kb").addEventListener("click", function(){
  S.airkb = !S.airkb;
  toggleBtn($("#btn-kb"), S.airkb);
  $("#airkb").dataset.on = S.airkb ? "1" : "0";
  clearInterval(kbTimer); kbTimer = null;
  if(S.airkb){
    log("Air keyboard projected \u00b7 pinch-to-commit enabled", "ok");
    setAction("AIR_INPUT");
    var keys = document.querySelectorAll(".key");
    // kbTimer = setInterval(function(){
    //   var k = keys[Math.floor(Math.random()*keys.length)];
    //   k.classList.add("hot");
    //   setTimeout(function(){ k.classList.remove("hot"); }, 190);
    //   S.kbBuf = (S.kbBuf + k.dataset.k).slice(-18);
    //   $("#kb-buf").textContent = "BUF " + S.kbBuf.length;
    //   $("#promptin").value = S.kbBuf;
    // }, 700);
  }else{
    log("Air keyboard retracted \u00b7 buffer \"" + (S.kbBuf || "empty") + "\" discarded", "warn");
    S.kbBuf = ""; $("#kb-buf").textContent = "BUF 0"; $("#promptin").value = "";
    setAction(restAction());
  }
});

/* push to talk */
var talk = $("#btn-talk");
var UTTERANCES = [
  "open the terminal on workspace two",
  "summarise what changed on this machine today",
  "bind drag lock to my left hand only",
  "mute every notification except the console"
];
function talkStart(e){
  if(e && e.cancelable) e.preventDefault();
  if(S.talking) return;
  S.talking = true;
  talk.dataset.live = "1";
  talk.querySelector(".state").textContent = "LIVE";
  setStatus("LISTENING", "#ff3b5c");
  setAction("MIC_CAPTURE");
  log("Mic hot \u00b7 48kHz mono \u00b7 voice activity detection engaged", "sys", "[AUD]");
}
function talkEnd(){
  if(!S.talking) return;
  S.talking = false;
  talk.dataset.live = "0";
  talk.querySelector(".state").textContent = "HOLD";
  setStatus("ONLINE", "#39ff9e");
  var utter = UTTERANCES[Math.floor(Math.random()*UTTERANCES.length)];
  log("Transcript: \"" + utter + "\"", "ok", "[AUD]");
  dispatch(utter, true);
}
talk.addEventListener("mousedown", talkStart);
talk.addEventListener("touchstart", talkStart, {passive:false});
window.addEventListener("mouseup", talkEnd);
window.addEventListener("touchend", talkEnd);
talk.addEventListener("keydown", function(e){
  if(e.code === "Space" || e.code === "Enter"){ e.preventDefault(); talkStart(); }
});
talk.addEventListener("keyup", function(e){
  if(e.code === "Space" || e.code === "Enter"){ e.preventDefault(); talkEnd(); }
});

$("#btn-voice").addEventListener("click", function(){
  S.voice = !S.voice;
  $("#btn-voice").setAttribute("aria-pressed", String(S.voice));
  if(S.voice){
    log("Live voice mode on \u00b7 wake word \"ada\" \u00b7 always listening", "ok");
    setStatus("LISTENING", "#00f0ff");
    setAction("WAKE_WATCH");
  }else{
    log("Live voice mode off \u00b7 mic released", "warn");
    setStatus("ONLINE", "#39ff9e");
    setAction(restAction());
  }
});


/* ---------------- gesture cursor ---------------- */
var VC = {
  el:$("#vcursor"), tip:$("#vctip"),
  x:innerWidth/2, y:innerHeight/2, tx:innerWidth/2, ty:innerHeight/2,
  on:false, grip:false, hot:null, lastClick:0, seen:0
};
var CURSOR_GAIN = 1.7;   /* small hand movements should reach the screen edges */

function clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }

function cursorShow(on){
  if(VC.on === on) return;
  VC.on = on;
  VC.el.classList.toggle("on", on);
  if(!on){ cursorHot(null); VC.grip = false; VC.el.classList.remove("grip"); }
}

function cursorHot(el){
  if(VC.hot === el) return;
  if(VC.hot) VC.hot.classList.remove("vc-hot");
  VC.hot = el;
  if(el) el.classList.add("vc-hot");
}

/* palm centre (landmark 9) anchors the cursor: it stays put when the hand closes */
function cursorTrack(lm){
  VC.seen = performance.now();
  cursorShow(true);
  /* a closed hand is a click, not a move: hold the cursor still while it is shut
     so the pointer cannot drift off target during the gesture */
  if(VC.grip) return;
  var nx = clamp01(0.5 + ((1 - lm[9].x) - 0.5) * CURSOR_GAIN);
  var ny = clamp01(0.5 + (lm[9].y - 0.5) * CURSOR_GAIN);
  VC.tx = nx * innerWidth;
  VC.ty = ny * innerHeight;
  setPos(nx * 1920, ny * 1080);
}

function cursorFrame(){
  if(!VC.on) return;
  if(performance.now() - VC.seen > 900){ cursorShow(false); return; }   /* hand left frame */
  VC.x += (VC.tx - VC.x) * 0.32;
  VC.y += (VC.ty - VC.y) * 0.32;
  VC.el.style.transform = "translate(" + Math.round(VC.x) + "px," + Math.round(VC.y) + "px)";
  var under = document.elementFromPoint(VC.x, VC.y);
  var target = under ? under.closest("button, input, a, [role=button]") : null;
  cursorHot(target);
  VC.tip.textContent = target ? (controlName(target).slice(0, 22)) : (VC.grip ? "CLOSED" : "OPEN HAND");
}

function controlName(el){
  if(el.tagName === "INPUT") return el.getAttribute("aria-label") || el.placeholder || "INPUT";
  var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
  return (txt || el.id || el.tagName).toUpperCase();
}

/* closing the hand is a click on whatever the cursor is over */
function cursorClick(){
  var now = performance.now();
  if(now - VC.lastClick < 700) return;
  VC.lastClick = now;
  VC.el.classList.remove("fire");
  void VC.el.offsetWidth;
  VC.el.classList.add("fire");
  var under = document.elementFromPoint(VC.x, VC.y);
  var target = under ? under.closest("button, input, a, [role=button]") : null;
  if(!target){
    log("fist at " + Math.round(VC.x) + "," + Math.round(VC.y) + " - nothing under the cursor", "warn", "[CUR]");
    return;
  }
  if(target.tagName === "INPUT"){
    target.focus();
    log("focus -> " + controlName(target), "ok", "[CUR]");
    return;
  }
  log("click -> " + controlName(target), "ok", "[CUR]");
  target.click();
}

function cursorGrip(on){
  if(VC.grip === on) return;
  VC.grip = on;
  VC.el.classList.toggle("grip", on);
  if(on) cursorClick();
}

/* ---------------- operator access ---------------- */
/* Real accounts, checked by the bridge (see auth.py): a password hash lives in
   config.json, a session token lives in an httpOnly cookie, and neither ever
   touches localStorage or this file. Each account's Gemini/Claude/custom keys
   belong only to that account - see the KEYS panel above. Without a bridge
   there is nothing to sign into, so the sheet says so instead of faking it. */
var AUTH = { user:null, mode:"login" };

function authRender(){
  var chip = $("#authchip");
  chip.querySelector("b").textContent = AUTH.user || "GUEST";
  chip.style.setProperty("--st", AUTH.user ? "#39ff9e" : "#5d7488");
  $("#auth-signedin").hidden = !AUTH.user;
  $("#auth-signedout").hidden = !!AUTH.user;
  $("#auth-title").textContent = AUTH.user ? "Signed in" : (AUTH.mode === "register" ? "Create an account" : "Sign in");
  if(AUTH.user) $("#who").textContent = AUTH.user;
  var toggle = $("#auth-toggle");
  if(toggle) toggle.textContent = AUTH.mode === "register"
    ? "Have an account? Sign in instead" : "New here? Create an account instead";
  var go = $("#auth-go");
  if(go) go.textContent = AUTH.mode === "register" ? "CREATE ACCOUNT" : "SIGN IN";
}
function authOpen(){
  $("#auth").hidden = false;
  $("#auth-err").hidden = true;
  setTimeout(function(){
    var f = AUTH.user ? $("#signout") : $("#auth-user");
    if(f) f.focus();
  }, 30);
}
function authClose(){ $("#auth").hidden = true; }
function authErr(msg){
  var e = $("#auth-err");
  e.hidden = !msg;
  e.textContent = msg || "";
}
function authApplied(name){
  AUTH.user = name;
  authRender();
  authClose();
  $("#auth-pass").value = "";
  log((name ? "Signed in as " + name : "Signed out") + " — keys are scoped to this account", "ok", "[ACL]");
  keyLoad();
}
function authMe(){
  return fetch("/api/auth/me", { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){ AUTH.user = d.user || null; })
    .catch(function(){ AUTH.user = null; })
    .then(function(){
      authRender();
      /* prompt on every launch, not just on request: a visitor should see the
         sign-in choice up front rather than discover it later. Already signed
         in (cookie still valid) means no prompt - nothing to ask for. */
      if(!AUTH.user) authOpen();
    });
}
function signOut(){
  fetch("/api/auth/logout", { method:"POST" })
    .then(function(){ authApplied(null); })
    .catch(function(){ authApplied(null); });
}

$("#authchip").addEventListener("click", authOpen);
$("#auth-close").addEventListener("click", authClose);
$("#signout").addEventListener("click", signOut);
$("#auth").addEventListener("click", function(e){ if(e.target === $("#auth")) authClose(); });
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && !$("#auth").hidden) authClose();
});
if($("#auth-toggle")) $("#auth-toggle").addEventListener("click", function(){
  AUTH.mode = AUTH.mode === "register" ? "login" : "register";
  authErr(""); authRender();
});
$("#localform").addEventListener("submit", function(e){
  e.preventDefault();
  var user = $("#auth-user").value.trim();
  var pass = $("#auth-pass").value;
  if(!user || !pass){ authErr("username and password are both required"); return; }
  var path = AUTH.mode === "register" ? "/api/auth/register" : "/api/auth/login";
  authErr("");
  fetch(path, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ username:user, password:pass })
  })
  .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, body:d}; }); })
  .then(function(res){
    if(!res.ok || !res.body.ok){ authErr(res.body.error || "sign-in refused"); return; }
    authApplied(res.body.user);
  })
  .catch(function(){ authErr("no local bridge — run python serve.py to sign in"); });
});


/* ---------------- app launcher ---------------- */
/* Mirrors python/apps.py. https everywhere, except WhatsApp which prefers its
   desktop client through the local bridge. */
var APPS = [
  {key:"whatsapp", label:"WhatsApp", url:"https://web.whatsapp.com", proto:"whatsapp://", group:"desktop", desktop:true},
  {key:"youtube",  label:"YouTube",  url:"https://www.youtube.com",     group:"web"},
  {key:"gmail",    label:"Gmail",    url:"https://mail.google.com",     group:"web"},
  {key:"drive",    label:"Drive",    url:"https://drive.google.com",    group:"web"},
  {key:"maps",     label:"Maps",     url:"https://maps.google.com",     group:"web"},
  {key:"github",   label:"GitHub",   url:"https://github.com",          group:"web"},
  {key:"claude",   label:"Claude",   url:"https://claude.ai",           group:"web"},
  {key:"gemini",   label:"Gemini",   url:"https://gemini.google.com",   group:"web"},
  {key:"chatgpt",  label:"ChatGPT",  url:"https://chatgpt.com",         group:"web"},
  {key:"spotify",  label:"Spotify",  url:"https://open.spotify.com",    group:"web"},
  {key:"netflix",  label:"Netflix",  url:"https://www.netflix.com",     group:"web"},
  {key:"x",        label:"X",        url:"https://x.com",               group:"web"},
  {key:"linkedin", label:"LinkedIn", url:"https://www.linkedin.com",    group:"web"},
  {key:"instagram", label:"Instagram", url:"https://www.instagram.com", group:"web"},
  {key:"explorer", label:"File Explorer", group:"system", desktop:true},
  {key:"notepad",  label:"Notepad",      group:"system", desktop:true},
  {key:"calc",     label:"Calculator",   proto:"calculator://", group:"system", desktop:true},
  {key:"settings", label:"Settings",     proto:"ms-settings:", group:"system", desktop:true},
  {key:"terminal", label:"Terminal",     group:"system", desktop:true},
  {key:"vscode",   label:"VS Code",      proto:"vscode://", group:"system", desktop:true},
  {key:"camera",   label:"Camera",       proto:"microsoft.windows.camera:", group:"system", desktop:true}
];
var GROUPS = [
  ["custom", "Yours"],
  ["desktop", "Desktop client first"],
  ["web", "https web apps"],
  ["system", "On this PC - needs the local bridge"]
];
var BRIDGE = { up:false, checked:false };
/* The bridge is the source of truth once it answers: it knows this account's
   own shortcuts, and lists them first. Until then, or with no bridge at all,
   APPS (the static built-in list) is all there is to search or show. */
var LIVE_APPS = null;
var APPUSER = null;

function appList(){ return LIVE_APPS || APPS; }

function findApp(q){
  q = String(q || "").trim().toLowerCase();
  if(!q) return null;
  var list = appList();
  /* a custom app - one this account added - wins any ambiguous match, so
     "open figma" finds the Figma you saved before it finds anything built in */
  var custom = list.filter(function(a){ return a.custom; });
  var builtIn = list.filter(function(a){ return !a.custom; });
  var pools = [custom, builtIn];
  for(var p = 0; p < pools.length; p++){
    var pool = pools[p];
    var exact = pool.filter(function(a){ return a.key === q || a.label.toLowerCase() === q; });
    if(exact.length) return exact[0];
  }
  for(var p2 = 0; p2 < pools.length; p2++){
    var hits = pools[p2].filter(function(a){ return a.key.indexOf(q) >= 0 || a.label.toLowerCase().indexOf(q) >= 0; });
    if(hits.length === 1) return hits[0];
    if(hits.length > 1) return null;      // ambiguous within this pool - do not guess
  }
  return null;
}

function checkBridge(){
  var el = $("#bridge"), txt = $("#bridge-text");
  return fetch("/api/apps", { cache:"no-store" })
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("http " + r.status)); })
    .then(function(d){
      BRIDGE.up = !!(d && d.ok); BRIDGE.checked = true;
      APPUSER = d.user || null;
      LIVE_APPS = (d.apps || []).map(function(a){
        return { key:a.key, label:a.label, url:a.url, proto:"", group:a.group,
                 desktop:a.desktop, custom:!!a.custom };
      });
      el.className = "bridge up";
      txt.textContent = "LOCAL BRIDGE UP \u00b7 " + d.apps.length + " APPS \u00b7 DESKTOP LAUNCH READY";
      $("#app-add-open").hidden = !APPUSER;
      renderApps();
    })
    .catch(function(){
      BRIDGE.up = false; BRIDGE.checked = true;
      APPUSER = null; LIVE_APPS = null;
      el.className = "bridge down";
      txt.textContent = "NO LOCAL BRIDGE \u00b7 HTTPS + DESKTOP PROTOCOLS";
      $("#app-add-open").hidden = true;
      $("#app-add").hidden = true;
      renderApps();
    });
}

/* Hand a URL scheme to the operating system. The iframe keeps an unregistered
   scheme from navigating the console away; nothing is reported back either way,
   so the caller decides what to do next. */
function tryProtocol(proto){
  var f = document.createElement("iframe");
  f.style.display = "none";
  f.src = proto;
  document.body.appendChild(f);
  setTimeout(function(){ f.remove(); }, 1500);
}

/* No bridge: this page cannot start a program, but the visitor's own OS still
   answers protocol links. Try the scheme, then fall back to the web app only if
   we still have focus - losing focus means something launched. */
function launchWithoutBridge(app, why){
  if(app.proto){
    log("No bridge \u00b7 asking Windows to open " + app.label + " via " + app.proto, "sys", "[APP]");
    tryProtocol(app.proto);
    setTimeout(function(){
      if(document.hasFocus() && document.visibilityState === "visible" && app.url){
        window.open(app.url, "_blank", "noopener");
        log(app.label + " client did not answer \u00b7 opened " + app.url + " instead", "warn", "[APP]");
      }else{
        log(app.label + " handed to the desktop client", "ok", "[APP]");
      }
    }, 1600);
    return;
  }
  if(app.url){
    window.open(app.url, "_blank", "noopener");
    log(app.label + " opened in a new tab (" + app.url + ")", "ok", "[APP]");
    return;
  }
  log(app.label + " needs the local bridge \u00b7 run python serve.py (" + why + ")", "err", "[APP]");
}

function launchApp(key){
  var app = findApp(key);
  if(!app){
    log("No app matches \"" + key + "\" \u00b7 try: whatsapp, youtube, gmail, github, notepad", "warn", "[APP]");
    return;
  }
  setAction("LAUNCH");
  log("Launching " + app.label + "\u2026", "sys", "[APP]");

  fetch("/api/open?app=" + encodeURIComponent(app.key), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d.ok) throw new Error(d.error || "refused");
      log(app.label + " opened via " + d.via + " \u2192 " + d.target, "ok", "[APP]");
      chatPill(app.label + " opened", "ok");
      setAction(restAction());
    })
    .catch(function(err){
      launchWithoutBridge(app, err && err.message ? err.message : "no bridge");
      setAction(restAction());
    });
}

function renderApps(){
  var body = $("#appbody");
  body.textContent = "";
  var q = ($("#app-search").value || "").trim().toLowerCase();
  var pool = appList().filter(function(a){
    return !q || a.key.indexOf(q) >= 0 || a.label.toLowerCase().indexOf(q) >= 0;
  });

  GROUPS.forEach(function(g){
    var list = pool.filter(function(a){ return a.group === g[0]; });
    if(!list.length) return;
    var head = document.createElement("div");
    head.className = "appgroup";
    head.innerHTML = '<span class="label"></span><span class="rule"></span>';
    head.querySelector(".label").textContent = g[1];
    body.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "applist";
    list.forEach(function(a){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "apptile" + (a.desktop ? " desk" : "") + (a.custom ? " custom" : "");
      b.dataset.app = a.key;
      var mono = document.createElement("span");
      mono.className = "mono";
      mono.textContent = a.label.slice(0, 2).toUpperCase();
      var name = document.createElement("span");
      name.textContent = a.label;
      var how = document.createElement("span");
      how.className = "how";
      how.textContent = a.custom ? "YOURS" : (a.group === "web" ? "HTTPS" : (a.key === "whatsapp" ? "APP" : "LOCAL"));
      b.appendChild(mono); b.appendChild(name); b.appendChild(how);
      b.addEventListener("click", function(){ launchApp(a.key); });
      if(a.custom){
        var rm = document.createElement("span");
        rm.className = "apprm"; rm.textContent = "×";
        rm.setAttribute("role", "button");
        rm.setAttribute("aria-label", "Remove " + a.label);
        rm.addEventListener("click", function(e){ e.stopPropagation(); appRemove(a.key.slice(7), a.label); });
        b.appendChild(rm);
      }
      grid.appendChild(b);
    });
    body.appendChild(grid);
  });

  if(!pool.length){
    var empty = document.createElement("p");
    empty.className = "sheet-fine";
    empty.textContent = q ? "No app matches “" + q + "”." : "No apps to show.";
    body.appendChild(empty);
  }
}

function appAdd(label, url){
  return fetch("/api/apps/add", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ label:label, url:url })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(!d.ok){
      if(d.needs_login){ log("Sign in first — an added app needs an account to belong to", "warn", "[APP]"); authOpen(); return; }
      throw new Error(d.error || "refused");
    }
    log("Added " + label + " · custom:" + d.id, "ok", "[APP]");
    $("#app-add").hidden = true;
    $("#app-label").value = ""; $("#app-url").value = "";
    return checkBridge();
  })
  .catch(function(err){
    log("Could not add app · " + (err && err.message ? err.message : "no bridge"), "err", "[APP]");
  });
}

function appRemove(id, label){
  return fetch("/api/apps/remove", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ id:id })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    log(d.ok ? "Removed " + label : "Could not remove " + label, d.ok ? "ok" : "warn", "[APP]");
    return checkBridge();
  });
}

function appsOpen(){
  $("#applauncher").hidden = false;
  $("#app-search").value = "";
  checkBridge();
  setTimeout(function(){ $("#app-search").focus(); }, 30);
}
function appsClose(){ $("#applauncher").hidden = true; }

$("#appchip").addEventListener("click", appsOpen);
$("#app-close").addEventListener("click", appsClose);
$("#applauncher").addEventListener("click", function(e){
  if(e.target === $("#applauncher")) appsClose();
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && !$("#applauncher").hidden) appsClose();
});
$("#app-search").addEventListener("input", renderApps);
$("#app-add-open").addEventListener("click", function(){
  var f = $("#app-add"); f.hidden = !f.hidden;
  if(!f.hidden) $("#app-label").focus();
});
$("#app-add").addEventListener("submit", function(e){
  e.preventDefault();
  var label = $("#app-label").value.trim(), url = $("#app-url").value.trim();
  if(!label || !url){ log("Name and address are both required", "warn", "[APP]"); return; }
  appAdd(label, url);
});
renderApps();


/* ---------------- model channels ---------------- */
/* Every visitor gets Ollama for free - no secret involved. Gemini, Claude and
   anything added below need a signed-in account, because a key belongs to
   whoever typed it, never to every visitor who opens this page. */
var CH = { rows:[], bridge:false, active:"", user:null };

function custKind(r){ return r.channel.slice(7); }

function keyRow(r){
  var row = document.createElement("div");
  row.className = "keyrow" + (r.has_key ? " ready" : "") + (r.needs_login ? " locked" : "");

  var who = document.createElement("div");
  who.className = "who";
  var nm = document.createElement("span"); nm.className = "nm";
  nm.textContent = r.label + (r.custom ? "" : "");
  var st = document.createElement("span"); st.className = "st";
  st.textContent = r.needs_login ? "SIGN IN TO ADD A KEY"
    : r.needs_key ? (r.has_key ? "KEY " + (r.masked || "SET") : "NO KEY")
    : (r.ready_note === "running" ? "LOCAL \u00b7 RUNNING" : "LOCAL \u00b7 NOT RUNNING");
  who.appendChild(nm); who.appendChild(st);
  row.appendChild(who);

  var pick = document.createElement("div");
  pick.className = "pick";
  if(!r.needs_login && !r.custom && r.models && r.models.length){
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", r.label + " model");
    r.models.forEach(function(m){
      var o = document.createElement("option");
      o.value = m; o.textContent = m; o.selected = (m === r.model);
      sel.appendChild(o);
    });
    sel.addEventListener("change", function(){ keySave(r.channel, "", sel.value, false); });
    pick.appendChild(sel);
  }
  if(r.needs_login){
    var signin = document.createElement("button");
    signin.type = "button"; signin.className = "use";
    signin.textContent = "SIGN IN";
    signin.addEventListener("click", authOpen);
    pick.appendChild(signin);
  }else{
    var use = document.createElement("button");
    use.type = "button"; use.className = "use";
    use.dataset.on = r.default ? "1" : "0";
    use.textContent = r.default ? "ACTIVE" : "USE";
    use.addEventListener("click", function(){ keySave(r.channel, "", "", true); });
    pick.appendChild(use);
  }
  if(r.custom){
    var rm = document.createElement("button");
    rm.type = "button"; rm.className = "use";
    rm.textContent = "REMOVE";
    rm.addEventListener("click", function(){ llmRemove(custKind(r), r.label); });
    pick.appendChild(rm);
  }
  /* the add-a-model trigger sits right on the Ollama row, since that is the
     one channel everyone already has - the natural place to point at "you can
     add more of these" */
  if(r.channel === "ollama" && CH.user){
    var addLlm = document.createElement("button");
    addLlm.type = "button"; addLlm.className = "use addllm";
    addLlm.textContent = "+ ADD LLM";
    addLlm.addEventListener("click", function(){ llmToggleForm(row); });
    pick.appendChild(addLlm);
  }
  row.appendChild(pick);

  var frag = document.createDocumentFragment();
  frag.appendChild(row);

  if(r.needs_key && !r.needs_login && !r.custom){
    var form = document.createElement("form");
    form.className = "keyform";
    var inp = document.createElement("input");
    inp.type = "password";
    inp.autocomplete = "off";
    inp.placeholder = r.has_key ? "replace key\u2026" : "paste " + r.label + " API key";
    inp.setAttribute("aria-label", r.label + " API key");
    var go = document.createElement("button");
    go.type = "submit"; go.textContent = "SAVE KEY";
    form.appendChild(inp); form.appendChild(go);
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if(!inp.value.trim()) return;
      keySave(r.channel, inp.value.trim(), "", true);
      inp.value = "";
    });
    frag.appendChild(form);
  }
  return frag;
}

function keyRender(){
  var body = $("#keybody");
  body.textContent = "";
  $("#llm-add").hidden = true;      // re-rendering the list detaches it; reopen fresh next click

  if(!CH.bridge){
    var p = document.createElement("p");
    p.className = "sheet-fine";
    p.textContent = "No local bridge, so keys cannot be stored. Replies are simulated.";
    body.appendChild(p);
    return;
  }

  if(!CH.user){
    var note = document.createElement("p");
    note.className = "sheet-fine";
    note.textContent = "Signed out: only Local Ollama is live (it needs no secret). "
      + "Sign in to store your own Gemini, Claude or custom key \u2014 it is yours alone, "
      + "never shared with anyone else who opens this console.";
    body.appendChild(note);
  }

  CH.rows.filter(function(r){ return !r.custom; }).forEach(function(r){ body.appendChild(keyRow(r)); });

  var customRows = CH.rows.filter(function(r){ return r.custom; });
  if(CH.user && customRows.length){
    var h = document.createElement("div");
    h.className = "devgroup"; h.textContent = "YOUR MODELS";
    body.appendChild(h);
    customRows.forEach(function(r){ body.appendChild(keyRow(r)); });
  }
}

/* Moves the (single, reused) add-model form to sit right after whichever row
   opened it - "next to Ollama" in practice, since that is the only trigger -
   rather than leaving it pinned to the bottom of a list that grows underneath it. */
function llmToggleForm(anchorRow){
  var f = $("#llm-add");
  if(anchorRow && anchorRow.parentNode) anchorRow.insertAdjacentElement("afterend", f);
  f.hidden = !f.hidden;
  if(!f.hidden) $("#llm-label").focus();
}

function keyChip(){
  var chip = $("#keychip"), b = chip.querySelector("b");
  if(!CH.bridge){ b.textContent = "SIM"; chip.style.setProperty("--st", "#ffb020"); return; }
  var active = CH.rows.filter(function(r){ return r.default; })[0];
  var live = active && active.has_key;
  b.textContent = live ? (active.channel.toUpperCase()) : (CH.user ? "NO KEY" : "GUEST");
  chip.style.setProperty("--st", live ? "#39ff9e" : "#ffb020");
  CH.active = live ? active.channel : "";
}

/* Custom channels get a MODELS entry too, so applyModel() and dispatch() work
   on them exactly like the three built-ins - just with an amber accent to
   mark them as something the operator added rather than a shipped default. */
function syncCustomModels(rows){
  rows.filter(function(r){ return r.custom; }).forEach(function(r){
    MODELS[r.channel] = {
      label: r.label, short: r.label.slice(0, 10).toUpperCase(), build: r.model,
      accent:"#ffb020", rgb:"255,176,32", link:"CUSTOM", vram:"\u2014", ctx:"\u2014",
      replies:[
        r.label + " (custom endpoint) would answer here once " + r.base_url + " is live.",
        "This is a user-added model \u2014 the reply above is simulated until a real request completes."
      ]
    };
  });
}

function keyLoad(){
  return fetch("/api/models", { cache:"no-store" })
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("no bridge")); })
    .then(function(d){
      CH.rows = d.channels || []; CH.bridge = true; CH.user = d.user || null;
      syncCustomModels(CH.rows);
      /* the bridge owns which channel is active: make the header selector agree,
         or EXECUTE would route to whatever the header happened to show */
      if(d.default && MODELS[d.default] && d.default !== S.model) applyModel(d.default, false);
      var el = $("#keybridge");
      if(el){
        el.className = "bridge up";
        $("#keybridge-text").textContent = CH.user
          ? "LOCAL BRIDGE UP \u00b7 SIGNED IN AS " + CH.user.toUpperCase()
          : "LOCAL BRIDGE UP \u00b7 SIGNED OUT \u00b7 OLLAMA ONLY";
      }
      keyRender(); keyChip();
    })
    .catch(function(){
      CH.rows = []; CH.bridge = false; CH.user = null;
      var el = $("#keybridge");
      if(el){
        el.className = "bridge down";
        $("#keybridge-text").textContent = "NO LOCAL BRIDGE \u00b7 REPLIES ARE SIMULATED";
      }
      keyRender(); keyChip();
    });
}

/* the key goes straight to the local bridge, scoped to whoever is signed in;
   it is never logged to the console */
function keySave(channel, key, model, makeDefault){
  return fetch("/api/key", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ channel:channel, key:key, model:model, make_default:!!makeDefault })
  })
  .then(function(r){ return r.json().then(function(d){ return {status:r.status, body:d}; }); })
  .then(function(res){
    var d = res.body;
    if(!d.ok){
      if(d.needs_login){ log("Sign in first \u2014 keys belong to an account", "warn", "[KEY]"); authOpen(); return; }
      throw new Error(d.error || "refused");
    }
    CH.rows = d.channels || CH.rows;
    syncCustomModels(CH.rows);
    keyRender(); keyChip();
    if(key) log("Key stored for " + channel + " \u00b7 your account only", "ok", "[KEY]");
    if(model) log(channel + " model set to " + model, "ok", "[KEY]");
    if(makeDefault && !key && !model) log("Active channel \u2192 " + channel, "ok", "[KEY]");
    if(makeDefault && MODELS[channel]) applyModel(channel, false);
  })
  .catch(function(err){
    log("Could not store key \u00b7 " + (err && err.message ? err.message : "no bridge"), "err", "[KEY]");
  });
}

/* ---------------- add a custom LLM ---------------- */
function llmAdd(label, baseUrl, key, model){
  return fetch("/api/llm/add", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ label:label, base_url:baseUrl, key:key, model:model })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(!d.ok){
      if(d.needs_login){ log("Sign in first \u2014 a custom model needs an account to belong to", "warn", "[LLM]"); authOpen(); return; }
      throw new Error(d.error || "refused");
    }
    log("Added " + label + " \u00b7 custom:" + d.id, "ok", "[LLM]");
    $("#llm-add").hidden = true;
    ["llm-label","llm-url","llm-model","llm-key"].forEach(function(id){ $("#" + id).value = ""; });
    return keyLoad();
  })
  .catch(function(err){
    log("Could not add model \u00b7 " + (err && err.message ? err.message : "no bridge"), "err", "[LLM]");
  });
}

function llmRemove(id, label){
  return fetch("/api/llm/remove", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ id:id })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    log(d.ok ? "Removed " + label : "Could not remove " + label, d.ok ? "ok" : "warn", "[LLM]");
    delete MODELS["custom:" + id];
    return keyLoad();
  });
}

$("#keychip").addEventListener("click", function(){ $("#keysheet").hidden = false; keyLoad(); });
$("#key-close").addEventListener("click", function(){ $("#keysheet").hidden = true; });
$("#keysheet").addEventListener("click", function(e){
  if(e.target === $("#keysheet")) $("#keysheet").hidden = true;
});
if($("#llm-add")) $("#llm-add").addEventListener("submit", function(e){
  e.preventDefault();
  var label = $("#llm-label").value.trim(), url = $("#llm-url").value.trim();
  var model = $("#llm-model").value.trim(), key = $("#llm-key").value.trim();
  if(!label || !url || !model){ log("Name, base URL and model are all required", "warn", "[LLM]"); return; }
  llmAdd(label, url, key, model);
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && !$("#keysheet").hidden) $("#keysheet").hidden = true;
});
keyLoad();

/* ---------------- chat feed ---------------- */
/* A second, human-readable view onto the same conversation the LOG tab
   already tracks line-by-line: just the turns, as bubbles, tabbed alongside
   the full technical trace rather than replacing it. */
var chatfeed = $("#chatfeed");

function chatClearEmpty(){
  var empty = $("#chatempty");
  if(empty) empty.remove();
}
function chatAdd(role, text, opts){
  opts = opts || {};
  chatClearEmpty();
  var row = document.createElement("div");
  row.className = "bubblerow " + role + (opts.streaming ? " streaming" : "");
  if(opts.accent) row.style.setProperty("--bcolor", opts.accent);

  var av = document.createElement("span"); av.className = "bavatar";
  av.textContent = role === "you" ? "YOU" : (opts.short || "AI").slice(0, 3);

  var body = document.createElement("div");
  var bubble = document.createElement("div"); bubble.className = "bubble";
  bubble.textContent = text || "";
  var meta = document.createElement("div"); meta.className = "bmeta";
  var t = document.createElement("span"); t.textContent = stamp();
  meta.appendChild(t);
  if(opts.tag){ var tg = document.createElement("span"); tg.textContent = opts.tag; meta.appendChild(tg); }
  if(opts.sim){ var sm = document.createElement("span"); sm.className = "bsim"; sm.textContent = "SIMULATED"; meta.appendChild(sm); }
  body.appendChild(bubble); body.appendChild(meta);

  if(role === "you"){ row.appendChild(body); row.appendChild(av); }
  else{ row.appendChild(av); row.appendChild(body); }
  chatfeed.appendChild(row);
  chatfeed.scrollTop = chatfeed.scrollHeight;
  return { row:row, bubble:bubble };
}
function chatPill(text, kind){
  chatClearEmpty();
  var p = document.createElement("div");
  p.className = "chatpill" + (kind ? " " + kind : "");
  p.textContent = text;
  chatfeed.appendChild(p);
  chatfeed.scrollTop = chatfeed.scrollHeight;
}
function chatStream(role, text, opts){
  var made = chatAdd(role, "", Object.assign({ streaming:true }, opts || {}));
  if(reduced){ made.bubble.textContent = text; made.row.classList.remove("streaming"); return Promise.resolve(); }
  var caret = document.createElement("span"); caret.className = "caret";
  made.bubble.appendChild(caret);
  return new Promise(function(res){
    var i = 0;
    var id = setInterval(function(){
      i = Math.min(text.length, i + Math.ceil(Math.random()*3) + 1);
      made.bubble.textContent = text.slice(0, i);
      made.bubble.appendChild(caret);
      chatfeed.scrollTop = chatfeed.scrollHeight;
      if(i >= text.length){ clearInterval(id); caret.remove(); made.row.classList.remove("streaming"); res(); }
    }, 16);
  });
}
function chatTab(which){
  var chatOn = which === "chat";
  $("#tab-chat").classList.toggle("active", chatOn);
  $("#tab-chat").setAttribute("aria-selected", String(chatOn));
  $("#tab-log").classList.toggle("active", !chatOn);
  $("#tab-log").setAttribute("aria-selected", String(!chatOn));
  $("#chatwrap").hidden = !chatOn;
  $("#term").hidden = chatOn;
  if(!chatOn) term.scrollTop = term.scrollHeight;
}
$("#tab-chat").addEventListener("click", function(){ chatTab("chat"); });
$("#tab-log").addEventListener("click", function(){ chatTab("log"); });

/* ---------------- dispatch ---------------- */
var replyIdx = 0;
function dispatch(text, fromVoice){
  if(S.busy){ log("Inference queue busy \u2014 directive dropped", "warn"); return; }
  var m = MODELS[S.model];
  S.busy = true;
  setAction("GENERATING");
  setStatus("PROCESSING", "#ffb020");
  $("#core-mode").textContent = "INFERENCE";
  log((fromVoice ? "(voice) " : "") + text, "user");
  chatAdd("you", text, { tag: fromVoice ? "VOICE" : "" });
  /* report the model the bridge will actually use, not the demo build string */
  var liveRow = CH.rows.filter(function(r){ return r.channel === S.model; })[0];
  var liveModel = (liveRow && liveRow.model) || m.build;
  log("routing \u2192 " + liveModel +
      " \u00b7 temp 0.4 \u00b7 " + (CH.bridge ? "bridge" : "no bridge"), "sys", "[NET]");
  S.tok = 28 + Math.floor(Math.random()*48);
  var started = Date.now();

  function finish(){
    S.busy = false; S.tok = 0;
    $("#core-mode").textContent = (S.voice || S.camera) ? "ACTIVE" : "STANDBY";
    setStatus(S.talking ? "LISTENING" : "ONLINE", S.talking ? "#ff3b5c" : "#39ff9e");
    setAction(S.gesture ? S.action : "IDLE");
  }

  function simulate(why){
    var reply = m.replies[(replyIdx++) % m.replies.length];
    log("sample reply \u00b7 " + why, "warn", "[MDL]");
    Promise.all([
      stream(reply, "model", "[" + m.short.slice(0,3) + "]"),
      chatStream("model", reply, { short:m.short, accent:m.accent, sim:true, tag:m.short })
    ]).then(function(){
      log("complete \u00b7 " + reply.length + " chars \u00b7 simulated", "ok");
      finish();
    });
  }

  /* real model first: the bridge holds the key, so it never touches this page */
  fetch("/api/chat", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ prompt:text, channel:S.model })
  })
  .then(function(r){ return r.json().then(function(d){ return { status:r.status, d:d }; }); })
  .then(function(res){
    if(!res.d.ok) throw new Error(res.d.error || ("http " + res.status));
    var out = res.d;
    Promise.all([
      stream(out.text, "model", "[" + m.short.slice(0,3) + "]"),
      chatStream("model", out.text, { short:m.short, accent:m.accent, tag:out.model })
    ]).then(function(){
      log("complete \u00b7 " + out.text.length + " chars \u00b7 " + out.model + " \u00b7 " +
          (Date.now() - started) + "ms", "ok");
      finish();
    });
  })
  .catch(function(err){
    simulate(err && err.message ? err.message : "no bridge");
  });
}
$("#promptform").addEventListener("submit", function(e){
  e.preventDefault();
  var v = $("#promptin").value.trim();
  if(!v){ log("Empty directive \u2014 nothing to execute", "warn"); return; }
  /* "open whatsapp" launches an app instead of prompting the model */
  var dv = v.match(/^(?:dev|board|boards|hw)\s*(.*)$/i);
  if(dv){
    $("#promptin").value = "";
    S.kbBuf = ""; $("#kb-buf").textContent = "BUF 0";
    devCommand(dv[1]);
    return;
  }
  var bt = v.match(/^(?:bt|bluetooth)\s*(.*)$/i);
  if(bt){
    $("#promptin").value = "";
    S.kbBuf = ""; $("#kb-buf").textContent = "BUF 0";
    btCommand(bt[1]);
    return;
  }
  var opener = v.match(/^(?:open|launch|start|run)\s+(.+)$/i);
  if(opener){
    $("#promptin").value = "";
    S.kbBuf = ""; $("#kb-buf").textContent = "BUF 0";
    launchApp(opener[1]);
    return;
  }
  $("#promptin").value = "";
  S.kbBuf = ""; $("#kb-buf").textContent = "BUF 0";
  dispatch(v, false);
});

/* pointer \u2192 POS */
window.addEventListener("pointermove", function(e){
  if(S.gesture) return;
  setPos(e.clientX/window.innerWidth*1920, e.clientY/window.innerHeight*1080);
});

/* ---------------- clocks ---------------- */
setInterval(function(){
  var target = 8 + (S.camera?14:0) + (S.gesture?18:0) + (S.busy?42:0) + (S.voice?9:0) + Math.random()*8;
  S.load += (target - S.load)*0.25;
  S.amp = S.talking ? (0.55 + Math.random()*0.45) : (S.voice ? (0.15 + Math.random()*0.2) : 0);
  var ms = Date.now() - S.start;
  function p(n){ return String(n).padStart(2,"0"); }
  $("#lg-up").textContent = p(Math.floor(ms/3600000)) + ":" + p(Math.floor(ms/60000)%60) + ":" + p(Math.floor(ms/1000)%60);
  $("#lg-tok").textContent = S.busy ? S.tok : 0;
  $("#core-sub").textContent = "CORE LOAD " + Math.round(S.load) + "% \u00b7 " + (28 + Math.floor(Math.random()*40)) + "ms";
}, 500);

/* ---------------- render loop ---------------- */
var camFrame = 0;
function frame(t){
  drawReactor(t);
  drawMeter(t);
  cursorFrame();
  if(S.camera){
    if(MP.mode === "live"){
      if(S.gesture) readGestures(performance.now());
      drawCamLive(t);
    }else if(++camFrame % 2 === 0){
      drawCam(t);
    }
  }
  requestAnimationFrame(frame);
}

var BOOT = [
  ["A.D.A shell 4.2.0 \u2014 cold start \u00b7 operator deck: HYBRID AGENT", "sys"],
  ["Mounting runtime \u00b7 /opt/ada \u00b7 integrity verified", "ok"],
  ["Sensor bus: optical[0] audio[0] pointer[1]", "sys"],
  ["Gesture backend: MediaPipe tasks-vision \u00b7 loads on first arm", "sys"],
  ["Pointer bindings: open hand moves the cursor \u00b7 closed fist clicks", "sys"],
  ["Launcher ready \u00b7 https for every app, desktop client for WhatsApp", "sys"],
  ["Model registry: 3 channels available \u2014 gemini \u00b7 claude \u00b7 ollama", "sys"],
  ["Active channel \u2192 Google Gemini \u00b7 ctx 4.1k", "ok"],
  ["Model channels \u00b7 open KEYS to choose one and store its API key", "sys"],
  ["Matrix online. Awaiting directive.", "ok"]
];
function boot(){
  sizeReactor();
  applyModel("gemini", false);
  setPos(960, 540);
  authRender();
  authMe();
  if(reduced){
    drawReactor(0); drawMeter(0);
    BOOT.forEach(function(l){ log(l[0], l[1]); });
  }else{
    requestAnimationFrame(frame);
    BOOT.forEach(function(l, i){ setTimeout(function(){ log(l[0], l[1]); }, 260*i); });
  }
}
window.addEventListener("resize", sizeReactor);
if(window.ResizeObserver) new ResizeObserver(sizeReactor).observe(rc);

/* ---------------- bluetooth ---------------- */
/* The radio and the paired list come from Windows through the local bridge.
   Without the bridge a web page has no way to see a paired speaker at all, so
   the panel says that plainly instead of showing an empty list. */
var BT = { radio:null, devices:[], bridge:false, busy:"" };

var BTICON = { audio:"SPK", input:"HID", phone:"PHN", le:"LE", device:"BT" };

function btChip(){
  var chip = $("#btchip"), b = chip.querySelector("b");
  if(!BT.bridge){ b.textContent = "N/A"; chip.style.setProperty("--st", "#5d6b7a"); return; }
  if(!BT.radio || !BT.radio.on){ b.textContent = "OFF"; chip.style.setProperty("--st", "#ffb020"); return; }
  var live = BT.devices.filter(function(d){ return d.connected; });
  b.textContent = live.length ? String(live.length) + " LINKED" : "ON";
  chip.style.setProperty("--st", live.length ? "#39ff9e" : "#00f0ff");
}

function btRender(){
  var body = $("#btbody"), radio = $("#btradio");
  body.textContent = "";

  if(!BT.bridge){
    radio.hidden = true;
    var p = document.createElement("p");
    p.className = "sheet-fine";
    p.textContent = "No local bridge. A web page cannot read this machine's Bluetooth: "
      + "run python serve.py and open the console from it.";
    body.appendChild(p);
    return;
  }

  radio.hidden = false;
  var on = !!(BT.radio && BT.radio.on);
  radio.className = "btradio" + (on ? " on" : "");
  $("#btradio-state").textContent = BT.radio && BT.radio.error
    ? String(BT.radio.error).toUpperCase()
    : (on ? "ON" : "OFF");
  var toggle = $("#btradio-toggle");
  toggle.textContent = on ? "TURN OFF" : "TURN ON";
  toggle.disabled = BT.busy === "radio";

  if(!BT.devices.length){
    var q = document.createElement("p");
    q.className = "sheet-fine";
    q.textContent = on
      ? "Nothing paired yet. Pair a device in Windows first, then it shows up here."
      : "Radio is off, so Windows reports no devices.";
    body.appendChild(q);
    return;
  }

  BT.devices.forEach(function(d){
    var row = document.createElement("div");
    row.className = "btrow" + (d.connected ? " live" : "") + (BT.busy === d.key ? " busy" : "");

    var ic = document.createElement("span");
    ic.className = "mono";
    ic.textContent = BTICON[d.kind] || BTICON.device;
    row.appendChild(ic);

    var who = document.createElement("div");
    who.className = "who";
    var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = d.name;
    var st = document.createElement("span"); st.className = "st";
    st.textContent = (BT.busy === d.key ? "WORKING" : (d.connected ? "CONNECTED" : "PAIRED \u00b7 IDLE"))
      + " \u00b7 " + d.address;
    who.appendChild(nm); who.appendChild(st);
    row.appendChild(who);

    var act = document.createElement("button");
    act.type = "button";
    act.className = "act";
    act.textContent = d.connected ? "DISCONNECT" : "CONNECT";
    act.disabled = !!BT.busy || !on;
    act.addEventListener("click", function(){ btAct(d, d.connected ? "disconnect" : "connect"); });
    row.appendChild(act);

    body.appendChild(row);
  });
}

function btWhy(text){
  var body = $("#btbody");
  var old = body.parentNode.querySelector(".btwhy");
  if(old) old.remove();
  if(!text) return;
  var el = document.createElement("div");
  el.className = "btwhy";
  el.textContent = text;
  body.parentNode.insertBefore(el, body);
}

function btLoad(quiet){
  return fetch("/api/bt", { cache:"no-store" })
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("no bridge")); })
    .then(function(d){
      BT.bridge = true;
      BT.radio = d.radio || { on:false };
      BT.devices = d.devices || [];
      var el = $("#btbridge");
      if(el){
        el.className = "bridge up";
        $("#btbridge-text").textContent = "LOCAL BRIDGE UP \u00b7 " + BT.devices.length + " PAIRED";
      }
      btRender(); btChip();
      if(!quiet){
        var live = BT.devices.filter(function(x){ return x.connected; }).length;
        log("Bluetooth radio " + (BT.radio.on ? "ON" : "OFF") + " \u00b7 "
            + BT.devices.length + " paired \u00b7 " + live + " connected", "ok", "[BT ]");
      }
    })
    .catch(function(){
      BT.bridge = false; BT.radio = null; BT.devices = [];
      var el = $("#btbridge");
      if(el){
        el.className = "bridge down";
        $("#btbridge-text").textContent = "NO LOCAL BRIDGE \u00b7 BLUETOOTH UNAVAILABLE";
      }
      btRender(); btChip();
      if(!quiet) log("Bluetooth needs the local bridge \u00b7 run python serve.py", "warn", "[BT ]");
    });
}

function btAct(dev, verb){
  if(BT.busy) return;
  BT.busy = dev.key; btWhy(""); btRender();
  log(verb === "connect" ? "Connecting \u2192 " + dev.name : "Dropping \u2192 " + dev.name, "sys", "[BT ]");

  return fetch("/api/bt/" + verb + "?dev=" + encodeURIComponent(dev.key), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){
      BT.busy = "";
      if(d.ok){
        log(d.note || (dev.name + " " + verb + "ed"), "ok", "[BT ]");
      }else{
        log(d.error || (verb + " refused"), "warn", "[BT ]");
        btWhy(d.error || "");
      }
      return btLoad(true);
    })
    .catch(function(err){
      BT.busy = "";
      log("Bluetooth " + verb + " failed \u00b7 " + (err && err.message ? err.message : "no bridge"), "err", "[BT ]");
      btRender();
    });
}

function btRadio(on){
  if(BT.busy) return;
  BT.busy = "radio"; btWhy(""); btRender();
  return fetch("/api/bt/radio?state=" + (on ? "on" : "off"), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){
      BT.busy = "";
      if(d.ok) log("Bluetooth radio \u2192 " + String(d.state || (on ? "on" : "off")).toUpperCase(), "ok", "[BT ]");
      else { log(d.error || "Windows refused the radio change", "warn", "[BT ]"); btWhy(d.error || ""); }
      return btLoad(true);
    })
    .catch(function(){
      BT.busy = "";
      log("Could not reach the bridge for the radio", "err", "[BT ]");
      btRender();
    });
}

/* "bt", "bt on", "bt connect jbl" typed into the prompt */
function btCommand(rest){
  rest = String(rest || "").trim().toLowerCase();
  if(rest === "" || rest === "list" || rest === "status"){
    $("#btsheet").hidden = false;
    btLoad(false);
    return;
  }
  if(!BT.bridge){ log("Bluetooth needs the local bridge", "warn", "[BT ]"); return; }
  if(rest === "on" || rest === "off"){ btRadio(rest === "on"); return; }

  var m = rest.match(/^(connect|disconnect|drop)\s+(.+)$/);
  if(!m){ log("bt: try  bt \u00b7 bt on \u00b7 bt off \u00b7 bt connect <device>", "warn", "[BT ]"); return; }
  var q = m[2];
  var hits = BT.devices.filter(function(d){
    return d.key.indexOf(q) >= 0 || d.name.toLowerCase().indexOf(q) >= 0;
  });
  if(!hits.length){ log("No paired device matching \u201c" + q + "\u201d", "warn", "[BT ]"); return; }
  if(hits.length > 1){
    log("\u201c" + q + "\u201d matches " + hits.length + " devices \u00b7 open the BT panel", "warn", "[BT ]");
    return;
  }
  btAct(hits[0], m[1] === "connect" ? "connect" : "disconnect");
}

$("#btchip").addEventListener("click", function(){ $("#btsheet").hidden = false; btLoad(true); });
$("#bt-close").addEventListener("click", function(){ $("#btsheet").hidden = true; });
$("#btsheet").addEventListener("click", function(e){
  if(e.target === $("#btsheet")) $("#btsheet").hidden = true;
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && !$("#btsheet").hidden) $("#btsheet").hidden = true;
});
$("#btradio-toggle").addEventListener("click", function(){
  btRadio(!(BT.radio && BT.radio.on));
});
$("#bt-pane").addEventListener("click", function(){
  fetch("/api/bt/pane", { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){ log(d.ok ? "Opened Windows Bluetooth settings" : (d.error || "could not open settings"),
                           d.ok ? "ok" : "warn", "[BT ]"); })
    .catch(function(){ log("Bluetooth settings need the local bridge", "warn", "[BT ]"); });
});
btLoad(true);


/* ---------------- boards, mini computers, phones ---------------- */
/* Serial ports, saved network hosts and adb phones all come from the bridge:
   a browser cannot see a COM port or run adb, so without the bridge this panel
   says so rather than showing an empty list that looks like "nothing there". */
var DEV = { serial:[], network:[], phones:[], tools:{}, bridge:false, busy:"" };

function devCount(){
  return DEV.serial.concat(DEV.network, DEV.phones)
    .filter(function(d){ return d.connected; }).length;
}

function devChip(){
  var chip = $("#devchip"), b = chip.querySelector("b");
  if(!DEV.bridge){ b.textContent = "N/A"; chip.style.setProperty("--st", "#5d6b7a"); return; }
  var live = devCount();
  var total = DEV.serial.length + DEV.network.length + DEV.phones.length;
  b.textContent = live ? String(live) + " LIVE" : String(total);
  chip.style.setProperty("--st", live ? "#39ff9e" : (total ? "#00f0ff" : "#5d6b7a"));
}

function devTools(){
  var el = $("#devtools");
  el.textContent = "";
  if(!DEV.bridge){ el.hidden = true; return; }
  el.hidden = false;
  [["pyserial","serial"],["adb","adb"],["scrcpy","mirror"],["ssh","ssh"]].forEach(function(t){
    var s = document.createElement("span");
    s.className = DEV.tools[t[0]] ? "on" : "";
    s.textContent = t[1].toUpperCase() + (DEV.tools[t[0]] ? " READY" : " MISSING");
    el.appendChild(s);
  });
}

function devRow(d, actions){
  var row = document.createElement("div");
  row.className = "btrow" + (d.connected ? " live" : "") + (DEV.busy === d.key ? " busy" : "");

  var ic = document.createElement("span");
  ic.className = "mono";
  ic.textContent = { serial:"MCU", network:"NET", phone:"PHN" }[d.kind] || "DEV";
  row.appendChild(ic);

  var who = document.createElement("div");
  who.className = "who";
  var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = d.name;
  var st = document.createElement("span"); st.className = "st";
  st.textContent = (DEV.busy === d.key ? "WORKING"
                   : (d.connected ? "ANSWERING" : "NO ANSWER")) + " \u00b7 " + (d.detail || d.key);
  who.appendChild(nm); who.appendChild(st);
  row.appendChild(who);

  var wrap = document.createElement("div");
  wrap.className = "pick";
  actions.forEach(function(a){
    var b = document.createElement("button");
    b.type = "button"; b.className = "act"; b.textContent = a[0];
    b.disabled = !!DEV.busy;
    b.addEventListener("click", function(){ a[1](d); });
    wrap.appendChild(b);
  });
  row.appendChild(wrap);
  return row;
}

function devRender(){
  var body = $("#devbody");
  body.textContent = "";
  $("#devadd").hidden = !DEV.bridge;
  devTools();

  if(!DEV.bridge){
    var p = document.createElement("p");
    p.className = "sheet-fine";
    p.textContent = "No local bridge. A web page cannot open a COM port or run adb: "
      + "run python serve.py and open the console from it.";
    body.appendChild(p);
    return;
  }

  function group(title, rows, empty, actions){
    var h = document.createElement("div");
    h.className = "devgroup"; h.textContent = title;
    body.appendChild(h);
    if(!rows.length){
      var e = document.createElement("div");
      e.className = "devempty"; e.textContent = empty;
      body.appendChild(e);
      return;
    }
    rows.forEach(function(d){ body.appendChild(devRow(d, actions)); });
  }

  group("MICROCONTROLLERS \u00b7 USB SERIAL", DEV.serial,
    DEV.tools.pyserial ? "Nothing plugged in. Connect an Arduino, ESP32 or Pico over USB."
                       : "pyserial is not installed \u2014 pip install pyserial",
    [["PING", function(d){ devSend(d, ""); }]]);

  group("MINI COMPUTERS \u00b7 NETWORK", DEV.network,
    "Nothing saved yet. Add a Raspberry Pi below by name and address.",
    [["CHECK", function(d){ devLoad(false); }],
     ["SSH", function(d){ devSsh(d); }],
     ["FORGET", function(d){ devForget(d); }]]);

  group("PHONES \u00b7 ADB", DEV.phones,
    DEV.tools.adb ? "No phone. Plug one in with USB debugging on, or type "
                    + "dev phone 192.168.0.55 to pair wireless debugging."
                  : "adb not found \u2014 install scrcpy or the Android platform tools",
    [["MIRROR", function(d){ devMirror(d); }],
     ["DROP", function(d){ devPhone("disconnect", d.serial); }]]);
}

function devLoad(quiet){
  return fetch("/api/dev", { cache:"no-store" })
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("no bridge")); })
    .then(function(d){
      DEV.bridge = true;
      DEV.serial = d.serial || []; DEV.network = d.network || [];
      DEV.phones = d.phones || []; DEV.tools = d.tools || {};
      var el = $("#devbridge");
      if(el){
        el.className = "bridge up";
        $("#devbridge-text").textContent = "LOCAL BRIDGE UP \u00b7 "
          + (function(n){ return n + (n === 1 ? " DEVICE KNOWN" : " DEVICES KNOWN"); })(
              DEV.serial.length + DEV.network.length + DEV.phones.length);
      }
      devRender(); devChip();
      if(!quiet){
        log("Hardware scan \u00b7 " + DEV.serial.length + " serial \u00b7 "
            + DEV.network.length + " network \u00b7 " + DEV.phones.length + " phone"
            + (DEV.phones.length === 1 ? "" : "s"), "ok", "[DEV]");
      }
    })
    .catch(function(){
      DEV.bridge = false; DEV.serial = []; DEV.network = []; DEV.phones = [];
      var el = $("#devbridge");
      if(el){
        el.className = "bridge down";
        $("#devbridge-text").textContent = "NO LOCAL BRIDGE \u00b7 HARDWARE UNAVAILABLE";
      }
      devRender(); devChip();
      if(!quiet) log("Hardware needs the local bridge \u00b7 run python serve.py", "warn", "[DEV]");
    });
}

function devBusy(key, fn){
  if(DEV.busy) return;
  DEV.busy = key; devRender();
  return fn().then(function(){ DEV.busy = ""; return devLoad(true); })
             .catch(function(){ DEV.busy = ""; devRender(); });
}

function devSend(d, line){
  return devBusy(d.key, function(){
    log("Serial \u2192 " + d.port + (line ? " \u00b7 " + line : " \u00b7 open"), "sys", "[DEV]");
    return fetch("/api/dev/send?port=" + encodeURIComponent(d.port)
                 + "&line=" + encodeURIComponent(line), { cache:"no-store" })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(!res.ok){ log(res.error || "serial refused", "warn", "[DEV]"); return; }
        log(res.note, "ok", "[DEV]");
        (res.reply || []).forEach(function(l){ log("< " + l, "model", "[MCU]"); });
        if(!(res.reply || []).length) log("no reply \u00b7 fine if the sketch does not answer",
                                          "sys", "[DEV]");
      });
  });
}

function devSsh(d){
  return fetch("/api/dev/ssh?key=" + encodeURIComponent(d.key), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if(!res.ok){ log(res.error || "no such device", "warn", "[DEV]"); return; }
      log("run this yourself: " + res.command, "ok", "[DEV]");
      log(res.note, "sys", "[DEV]");
    })
    .catch(function(){ log("SSH hint needs the bridge", "warn", "[DEV]"); });
}

function devForget(d){
  return devBusy(d.key, function(){
    return fetch("/api/dev/forget?key=" + encodeURIComponent(d.key), { cache:"no-store" })
      .then(function(r){ return r.json(); })
      .then(function(res){ log(res.ok ? "Forgot " + d.name : "Nothing to forget",
                               res.ok ? "ok" : "warn", "[DEV]"); });
  });
}

function devPhone(verb, target){
  return devBusy("phone", function(){
    return fetch("/api/dev/phone?do=" + verb + "&target=" + encodeURIComponent(target || ""),
                 { cache:"no-store" })
      .then(function(r){ return r.json(); })
      .then(function(res){ log(res.ok ? (res.note || verb + " ok")
                                      : (res.error || verb + " refused"),
                               res.ok ? "ok" : "warn", "[DEV]"); });
  });
}

function devMirror(d){
  return devPhone("mirror", d.serial);
}

/* "dev", "dev add pi 192.168.0.21", "dev send com3 LED ON", "dev phone <ip>" */
function devCommand(rest){
  rest = String(rest || "").trim();
  var low = rest.toLowerCase();
  if(low === "" || low === "list" || low === "scan"){
    $("#devsheet").hidden = false;
    devLoad(false);
    return;
  }
  if(!DEV.bridge){ log("Hardware needs the local bridge", "warn", "[DEV]"); return; }

  var m = rest.match(/^send\s+(\S+)\s*(.*)$/i);
  if(m){
    var port = m[1].toUpperCase();
    var hit = DEV.serial.filter(function(d){ return d.port.toUpperCase() === port; })[0];
    if(!hit){ log("No serial device on " + port, "warn", "[DEV]"); return; }
    devSend(hit, m[2]);
    return;
  }
  m = rest.match(/^add\s+(\S+)\s+(\S+)$/i);
  if(m){
    devAdd(m[1], m[2]);
    return;
  }
  m = rest.match(/^phone\s+(\S+)$/i);
  if(m){ devPhone("connect", m[1]); return; }
  if(low === "mirror"){ devPhone("mirror", ""); return; }

  log("dev: try  dev \u00b7 dev send com3 <text> \u00b7 dev add pi <host> \u00b7 dev phone <ip> \u00b7 dev mirror",
      "warn", "[DEV]");
}

function devAdd(key, host){
  return fetch("/api/dev/add?key=" + encodeURIComponent(key)
               + "&host=" + encodeURIComponent(host), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(res){
      log(res.ok ? res.note : (res.error || "refused"), res.ok ? "ok" : "warn", "[DEV]");
      return devLoad(true);
    })
    .catch(function(){ log("Saving a host needs the bridge", "warn", "[DEV]"); });
}

$("#devchip").addEventListener("click", function(){ $("#devsheet").hidden = false; devLoad(true); });
$("#dev-close").addEventListener("click", function(){ $("#devsheet").hidden = true; });
$("#devsheet").addEventListener("click", function(e){
  if(e.target === $("#devsheet")) $("#devsheet").hidden = true;
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && !$("#devsheet").hidden) $("#devsheet").hidden = true;
});
$("#devadd").addEventListener("submit", function(e){
  e.preventDefault();
  var k = $("#devadd-key").value.trim(), h = $("#devadd-host").value.trim();
  if(!k || !h){ log("A saved host needs a name and an address", "warn", "[DEV]"); return; }
  $("#devadd-key").value = ""; $("#devadd-host").value = "";
  devAdd(k, h);
});
devLoad(true);

boot();
})();
