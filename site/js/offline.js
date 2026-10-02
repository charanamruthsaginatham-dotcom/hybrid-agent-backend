/* HYBRID AGENT - offline engine: builds apps and runs Nexus commands with no AI model.
   Build: the prompt picks a template + title/colour/theme; follow-ups edit those settings.
   Agent: plain-English commands map straight onto the Nexus tools.
   Each template's app code is a real function below, serialised into the page it builds. */
(function(){
"use strict";

function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------------- shared page shell ---------------- */
var COLORS = {
  red:"#ef4444", orange:"#f97316", amber:"#f59e0b", yellow:"#eab308", gold:"#d4a017", lime:"#84cc16",
  green:"#22c55e", emerald:"#10b981", teal:"#14b8a6", cyan:"#06b6d4", sky:"#0ea5e9", blue:"#3b82f6",
  navy:"#1e40af", indigo:"#6366f1", purple:"#8b5cf6", violet:"#8b5cf6", pink:"#ec4899", rose:"#f43f5e",
  brown:"#a16207", grey:"#64748b", gray:"#64748b", black:"#334155"
};

function onColor(hex){
  var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.62 ? "#111111" : "#ffffff";
}

function themeCss(m){
  var t = m.dark
    ? "--bg:#0f1115;--card:#171a21;--fg:#eef0f4;--muted:#9aa3b2;--line:rgba(255,255,255,.1);"
    : "--bg:#f6f7f9;--card:#ffffff;--fg:#14171c;--muted:#5b6472;--line:rgba(0,0,0,.1);";
  return ":root{" + t + "--accent:" + m.accent + ";--on:" + onColor(m.accent) + ";--r:" + m.radius + "px;--scale:" + m.scale +
         ";--w:" + T[m.template].w + "px;color-scheme:" + (m.dark ? "dark" : "light") + "}\n";
}

var BASE_CSS = [
  "*{box-sizing:border-box}",
  "body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:400 calc(16px*var(--scale))/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;padding:32px 16px}",
  ".app{width:min(var(--w),100%)}",
  "h1{font-size:2em;line-height:1.1;margin:0 0 .25em;letter-spacing:-.02em}",
  ".sub{color:var(--muted);margin:0 0 1.4em}",
  ".card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px}",
  "button{font:inherit;cursor:pointer;border:0;border-radius:calc(var(--r)*.6);padding:.6em 1.1em;background:var(--accent);color:var(--on);font-weight:600;transition:filter .15s,transform .1s}",
  "button:hover:not(:disabled){filter:brightness(1.08)}button:active:not(:disabled){transform:translateY(1px)}button:disabled{opacity:.45;cursor:default}",
  "button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}",
  "input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--r)*.6);padding:.6em .8em;min-width:0}",
  ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
  ".row{display:flex;gap:8px;align-items:center}.row>input{flex:1}.between{justify-content:space-between}",
  ".muted{color:var(--muted)}.small{font-size:.85em}.center{text-align:center}",
  ".x{background:transparent;color:var(--muted);padding:.15em .5em;font-size:1.15em;font-weight:400}.x:hover{color:var(--fg)}",
  "ul,ol{list-style:none;padding:0;margin:0}"
].join("\n") + "\n";

var HELPERS = [
  "var S={get:function(k,d){try{var v=localStorage.getItem(CFG.key+k);return v?JSON.parse(v):d}catch(e){return d}},",
  "set:function(k,v){try{localStorage.setItem(CFG.key+k,JSON.stringify(v))}catch(e){}}};",
  "function $(s){return document.querySelector(s)}"
].join("\n");

function json(o){ return JSON.stringify(o).replace(/</g, "\\u003c"); }

function render(m){
  var t = T[m.template];
  var cfg = { title:m.title, accent:m.accent, key:"app-" + m.template + "-" };
  Object.keys(m.cfg || {}).forEach(function(k){ cfg[k] = m.cfg[k]; });
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + esc(m.title) + "</title>\n<style>\n" + themeCss(m) + BASE_CSS + t.css + "\n</style>\n</head>\n" +
    "<body" + (t.bodyClass ? " class=\"" + t.bodyClass + "\"" : "") + ">\n<main class=\"app\">\n" +
    t.html(m) + "\n</main>\n<script>\nvar CFG = " + json(cfg) + ";\n" + HELPERS + "\n(" + t.js.toString() + ")(CFG);\n</scr" + "ipt>\n</body>\n</html>\n";
}

function head(m, sub){ return "<h1>" + esc(m.title) + "</h1>\n<p class=\"sub\">" + esc(sub) + "</p>\n"; }

/* ---------------- templates ---------------- */
var T = {};

T.todo = {
  name:"To-do list", title:"My Tasks", w:560, accent:"#6366f1",
  words:["todo","to-do","to do","task","tasks","checklist","chores","errands"],
  html:function(m){ return head(m, "Add tasks, tick them off, clear what's done.") +
    '<div class="card"><form id="f" class="row"><input id="t" placeholder="Add a task..." aria-label="New task"><button>Add</button></form>' +
    '<div class="filters"><button type="button" data-f="all" class="on">All</button><button type="button" data-f="open">Active</button><button type="button" data-f="done">Done</button></div>' +
    '<ul id="list"></ul><p class="foot muted"><span id="left"></span><button type="button" id="clear" class="link">Clear done</button></p></div>'; },
  css:".filters{display:flex;gap:6px;margin:14px 0 6px}.filters button{background:transparent;color:var(--muted);border:1px solid var(--line);padding:.3em .8em;font-size:.85em}.filters button.on{background:var(--accent);color:var(--on);border-color:var(--accent)}" +
      "li{display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line)}li span{flex:1;overflow-wrap:anywhere}li.done span{text-decoration:line-through;color:var(--muted)}li input{width:18px;height:18px;accent-color:var(--accent)}" +
      ".foot{display:flex;justify-content:space-between;align-items:center;margin:12px 0 0}.link{background:transparent;color:var(--accent);padding:0}",
  js:function(CFG){
    var items = S.get("items", []), filter = "all";
    function save(){ S.set("items", items); }
    function draw(){
      var l = $("#list"); l.innerHTML = "";
      items.filter(function(i){ return filter === "all" || (filter === "done" ? i.done : !i.done); }).forEach(function(i){
        var li = document.createElement("li"); li.className = i.done ? "done" : "";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = i.done; cb.setAttribute("aria-label", "Done: " + i.text);
        cb.onchange = function(){ i.done = cb.checked; save(); draw(); };
        var sp = document.createElement("span"); sp.textContent = i.text;
        var del = document.createElement("button"); del.className = "x"; del.textContent = "×"; del.setAttribute("aria-label", "Delete " + i.text);
        del.onclick = function(){ items = items.filter(function(x){ return x !== i; }); save(); draw(); };
        li.append(cb, sp, del); l.appendChild(li);
      });
      $("#left").textContent = items.filter(function(i){ return !i.done; }).length + " left";
    }
    $("#f").onsubmit = function(e){
      e.preventDefault(); var v = $("#t").value.trim(); if(!v) return;
      items.push({ text:v, done:false }); $("#t").value = ""; save(); draw();
    };
    document.querySelectorAll("[data-f]").forEach(function(b){
      b.onclick = function(){
        filter = b.dataset.f;
        document.querySelectorAll("[data-f]").forEach(function(x){ x.classList.toggle("on", x === b); });
        draw();
      };
    });
    $("#clear").onclick = function(){ items = items.filter(function(i){ return !i.done; }); save(); draw(); };
    draw();
  }
};

T.pomodoro = {
  name:"Pomodoro timer", title:"Pomodoro", w:480, accent:"#ef4444",
  words:["pomodoro","focus timer","study timer","timer","focus","productivity timer"],
  html:function(m){ return head(m, "Focus in blocks, rest in between.") +
    '<div class="card center"><div class="dial"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52"/><circle class="prog" id="prog" cx="60" cy="60" r="52"/></svg>' +
    '<div class="readout"><div class="time" id="time">25:00</div><div class="phase" id="phase">Focus</div></div></div>' +
    '<div class="row controls"><button id="start">Start</button><button id="reset" class="ghost">Reset</button><button id="skip" class="ghost">Skip</button></div>' +
    '<div class="settings"><label>Focus <input id="focus" type="number" min="1" max="180"> min</label><label>Break <input id="brk" type="number" min="1" max="60"> min</label></div>' +
    '<p class="muted">Sessions completed: <b id="count">0</b></p></div>'; },
  css:".dial{position:relative;width:min(260px,70vw);margin:0 auto 20px}.dial svg{width:100%;transform:rotate(-90deg)}.track{fill:none;stroke:var(--line);stroke-width:8}" +
      ".prog{fill:none;stroke:var(--accent);stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .3s linear}body.onbreak .prog{stroke:#22c55e}" +
      ".readout{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.time{font-size:3em;font-weight:700;font-variant-numeric:tabular-nums}" +
      ".phase{color:var(--muted);text-transform:uppercase;letter-spacing:.15em;font-size:.8em}.controls{justify-content:center}.settings{display:flex;gap:16px;justify-content:center;margin:20px 0 8px;flex-wrap:wrap}.settings input{width:4.5em}",
  js:function(CFG){
    var C = 2 * Math.PI * 52, prog = $("#prog");
    prog.style.strokeDasharray = C;
    var mins = { focus:S.get("focus", CFG.focus || 25), rest:S.get("rest", 5) };
    $("#focus").value = mins.focus; $("#brk").value = mins.rest;
    var phase = "focus", total = 0, left = 0, end = 0, timer = null, done = S.get("done", 0);
    function fmt(s){ var m = Math.floor(s/60), x = s % 60; return (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x; }
    function draw(){
      $("#time").textContent = fmt(left);
      $("#phase").textContent = phase === "focus" ? "Focus" : "Break";
      prog.style.strokeDashoffset = C * (1 - left / total);
      $("#start").textContent = timer ? "Pause" : "Start";
      $("#count").textContent = done;
      document.title = (timer ? fmt(left) + " · " : "") + CFG.title;
      document.body.classList.toggle("onbreak", phase !== "focus");
    }
    function beep(){
      try{
        var a = new (window.AudioContext || window.webkitAudioContext)();
        [0, .25, .5].forEach(function(t){
          var o = a.createOscillator(), g = a.createGain();
          o.frequency.value = 880; o.connect(g); g.connect(a.destination);
          g.gain.setValueAtTime(.2, a.currentTime + t);
          g.gain.exponentialRampToValueAtTime(.001, a.currentTime + t + .2);
          o.start(a.currentTime + t); o.stop(a.currentTime + t + .22);
        });
      }catch(e){}
    }
    function setPhase(p){ phase = p; total = (p === "focus" ? mins.focus : mins.rest) * 60; left = total; }
    function stop(){ clearInterval(timer); timer = null; }
    function tick(){
      left = Math.max(0, Math.round((end - Date.now()) / 1000));
      if(left === 0){
        stop(); beep();
        if(phase === "focus"){ done++; S.set("done", done); }
        setPhase(phase === "focus" ? "break" : "focus");
      }
      draw();
    }
    $("#start").onclick = function(){
      if(timer) stop(); else { end = Date.now() + left * 1000; timer = setInterval(tick, 250); }
      draw();
    };
    $("#reset").onclick = function(){ stop(); setPhase(phase); draw(); };
    $("#skip").onclick = function(){ stop(); setPhase(phase === "focus" ? "break" : "focus"); draw(); };
    function setMins(){
      mins.focus = Math.max(1, Math.min(180, +$("#focus").value || 25));
      mins.rest = Math.max(1, Math.min(60, +$("#brk").value || 5));
      S.set("focus", mins.focus); S.set("rest", mins.rest);
      if(!timer) setPhase(phase);
      draw();
    }
    $("#focus").onchange = setMins; $("#brk").onchange = setMins;
    setPhase("focus"); draw();
  }
};

T.stopwatch = {
  name:"Stopwatch", title:"Stopwatch", w:480, accent:"#0ea5e9",
  words:["stopwatch","stop watch","lap","laps","chronometer"],
  html:function(m){ return head(m, "Start, stop and record laps.") +
    '<div class="card center"><div class="time" id="time">00:00.00</div>' +
    '<div class="row controls"><button id="go">Start</button><button id="lap" class="ghost" disabled>Lap</button><button id="reset" class="ghost">Reset</button></div>' +
    '<ol id="laps" class="laps"></ol></div>'; },
  css:".time{font-size:3.4em;font-weight:700;font-variant-numeric:tabular-nums;margin:10px 0 18px}.controls{justify-content:center}" +
      ".laps{margin-top:18px;text-align:left}.laps li{display:grid;grid-template-columns:1fr 1fr 1fr;padding:8px 4px;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}",
  js:function(CFG){
    var start = 0, acc = 0, raf = 0, laps = [];
    function p(n){ return (n < 10 ? "0" : "") + n; }
    function now(){ return acc + (start ? Date.now() - start : 0); }
    function fmt(ms){ return p(Math.floor(ms/60000)) + ":" + p(Math.floor(ms/1000) % 60) + "." + p(Math.floor(ms/10) % 100); }
    function draw(){ $("#time").textContent = fmt(now()); if(start) raf = requestAnimationFrame(draw); }
    $("#go").onclick = function(){
      if(start){ acc += Date.now() - start; start = 0; cancelAnimationFrame(raf); $("#go").textContent = "Start"; draw(); }
      else { start = Date.now(); $("#go").textContent = "Stop"; draw(); }
      $("#lap").disabled = !start;
    };
    $("#lap").onclick = function(){
      var t = now(), prev = laps.length ? laps[laps.length - 1] : 0;
      laps.push(t);
      var li = document.createElement("li");
      [ "Lap " + laps.length, fmt(t - prev), fmt(t) ].forEach(function(txt, i){
        var s = document.createElement("span"); s.textContent = txt; if(i === 2) s.className = "muted"; li.appendChild(s);
      });
      $("#laps").prepend(li);
    };
    $("#reset").onclick = function(){
      start = 0; acc = 0; laps = []; cancelAnimationFrame(raf);
      $("#laps").innerHTML = ""; $("#go").textContent = "Start"; $("#lap").disabled = true; draw();
    };
    draw();
  }
};

T.calculator = {
  name:"Calculator", title:"Calculator", w:360, accent:"#f97316",
  words:["calculator","calc","arithmetic","maths","math"],
  html:function(m){ return head(m, "Click the keys or use your keyboard.") +
    '<div class="card"><div class="screen"><div class="expr muted" id="expr">&nbsp;</div><div class="out" id="out">0</div></div><div class="pad" id="pad"></div></div>'; },
  css:".screen{text-align:right;padding:8px 4px 16px;overflow:hidden}.expr{min-height:1.4em;font-size:.95em;overflow-wrap:anywhere}.out{font-size:2.6em;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}" +
      ".pad{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.pad button{padding:.9em 0;font-size:1.15em;background:var(--bg);color:var(--fg);border:1px solid var(--line)}" +
      ".pad button.op{background:var(--accent);color:var(--on);border-color:var(--accent)}.pad button.fn{color:var(--muted)}.pad button.eq{background:var(--fg);color:var(--bg)}",
  js:function(CFG){
    var toks = [], cur = "", justDone = false;
    var OPS = { "+":1, "−":1, "×":1, "÷":1 };
    var keys = ["C","±","%","÷","7","8","9","×","4","5","6","−","1","2","3","+","0",".","⌫","="];
    keys.forEach(function(k){
      var b = document.createElement("button");
      b.textContent = k;
      b.className = k === "=" ? "eq" : OPS[k] ? "op" : /[C±%⌫]/.test(k) ? "fn" : "";
      b.onclick = function(){ press(k); };
      $("#pad").appendChild(b);
    });
    function num(n){ return String(parseFloat(n.toPrecision(12))); }
    function compute(t){
      var a = t.slice(), i;
      for(i = 1; i < a.length; i += 2){
        if(a[i] === "×" || a[i] === "÷"){
          var l = parseFloat(a[i-1]), r = parseFloat(a[i+1]);
          if(a[i] === "÷" && r === 0) return NaN;
          a.splice(i - 1, 3, String(a[i] === "×" ? l * r : l / r)); i -= 2;
        }
      }
      var v = parseFloat(a[0]);
      for(i = 1; i < a.length; i += 2) v = a[i] === "+" ? v + parseFloat(a[i+1]) : v - parseFloat(a[i+1]);
      return v;
    }
    function show(){
      $("#expr").textContent = toks.join(" ") || " ";
      $("#out").textContent = cur || (toks.length ? toks[toks.length - (OPS[toks[toks.length-1]] ? 2 : 1)] : "0");
    }
    function press(k){
      if(/^[0-9]$/.test(k)){
        if(justDone){ cur = ""; justDone = false; }
        cur = cur === "0" ? k : cur === "-0" ? "-" + k : cur + k;
      }else if(k === "."){
        if(justDone){ cur = ""; justDone = false; }
        if(cur.indexOf(".") < 0) cur = (cur === "" || cur === "-" ? cur + "0" : cur) + ".";
      }else if(OPS[k]){
        justDone = false;
        if(cur !== "" && cur !== "-"){ toks.push(cur); cur = ""; }
        if(!toks.length) return;
        if(OPS[toks[toks.length-1]]) toks[toks.length-1] = k; else toks.push(k);
      }else if(k === "="){
        if(cur !== "" && cur !== "-") toks.push(cur);
        if(OPS[toks[toks.length-1]]) toks.pop();
        if(!toks.length) return;
        var v = compute(toks);
        toks = []; cur = isNaN(v) || !isFinite(v) ? "" : num(v); justDone = true;
        show(); if(!cur) $("#out").textContent = "Error";
        return;
      }else if(k === "C"){ toks = []; cur = ""; justDone = false; }
      else if(k === "±"){ cur = cur.charAt(0) === "-" ? cur.slice(1) : "-" + (cur || "0"); justDone = false; }
      else if(k === "%"){ if(cur) cur = num(parseFloat(cur) / 100); }
      else if(k === "⌫"){ if(cur) cur = cur.slice(0, -1); else if(toks.length) toks.pop(); justDone = false; }
      show();
    }
    document.addEventListener("keydown", function(e){
      var map = { "*":"×", "/":"÷", "-":"−", "+":"+", "Enter":"=", "=":"=", "Backspace":"⌫", "Escape":"C", "%":"%", ".":".", ",":"." };
      var k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
      if(k){ e.preventDefault(); press(k); }
    });
    show();
  }
};

T.expense = {
  name:"Expense tracker", title:"Expense Tracker", w:920, accent:"#10b981",
  words:["expense","expenses","budget","spending","finance","money tracker","spend"],
  html:function(m){ return head(m, "Log what you spend and see where it goes.") +
    '<div class="grid"><div class="card"><form id="f" class="form"><input id="desc" placeholder="What was it?" aria-label="Description">' +
    '<input id="amt" type="number" step="0.01" min="0" placeholder="Amount" aria-label="Amount"><select id="cat" aria-label="Category"></select><button>Add</button></form>' +
    '<ul id="list" class="list"></ul><p id="empty" class="muted">No expenses yet.</p></div>' +
    '<div class="card"><p class="muted">Total spent</p><div class="big" id="total"></div><p class="muted" id="count"></p>' +
    '<canvas id="pie" width="240" height="240" aria-label="Spending by category"></canvas><ul id="legend" class="legend"></ul></div></div>'; },
  css:".grid{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;align-items:start}@media(max-width:720px){.grid{grid-template-columns:1fr}}" +
      ".form{display:grid;grid-template-columns:1fr 110px 1fr auto;gap:8px}@media(max-width:520px){.form{grid-template-columns:1fr 1fr}}" +
      ".list li{display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--line)}.list li span:first-child{overflow-wrap:anywhere}" +
      ".tag{font-size:.75em;padding:.15em .6em;border-radius:99px;color:#fff}.big{font-size:2.4em;font-weight:700}#empty{margin:14px 0 0}" +
      "canvas{display:block;margin:12px auto;max-width:100%}.legend li{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.9em}.legend i{width:10px;height:10px;border-radius:3px;flex:none}",
  js:function(CFG){
    var cur = CFG.currency || "$";
    var cats = ["Food","Transport","Housing","Bills","Shopping","Fun","Health","Other"];
    var colors = ["#f97316","#3b82f6","#8b5cf6","#ef4444","#ec4899","#22c55e","#14b8a6","#94a3b8"];
    var items = S.get("items", []), sel = $("#cat");
    cats.forEach(function(c){ var o = document.createElement("option"); o.textContent = c; sel.appendChild(o); });
    function money(n){ return cur + n.toFixed(2); }
    function draw(){
      var list = $("#list"), by = {}, total = 0;
      list.innerHTML = "";
      items.slice().reverse().forEach(function(it){
        total += it.amount; by[it.cat] = (by[it.cat] || 0) + it.amount;
        var li = document.createElement("li");
        var d = document.createElement("span"); d.textContent = it.desc;
        var c = document.createElement("span"); c.className = "tag"; c.textContent = it.cat; c.style.background = colors[cats.indexOf(it.cat)];
        var a = document.createElement("b"); a.textContent = money(it.amount);
        var x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "Delete " + it.desc);
        x.onclick = function(){ items.splice(items.indexOf(it), 1); S.set("items", items); draw(); };
        li.append(d, c, a, x); list.appendChild(li);
      });
      $("#total").textContent = money(total);
      $("#count").textContent = items.length + " expense" + (items.length === 1 ? "" : "s");
      $("#empty").hidden = items.length > 0;
      pie(by, total);
    }
    function pie(by, total){
      var cv = $("#pie"), x = cv.getContext("2d"), w = cv.width, h = cv.height, r = Math.min(w, h)/2 - 6, a = -Math.PI/2;
      var leg = $("#legend"); x.clearRect(0, 0, w, h); leg.innerHTML = "";
      if(!total){ x.beginPath(); x.arc(w/2, h/2, r, 0, Math.PI*2); x.strokeStyle = "rgba(128,128,128,.35)"; x.lineWidth = 2; x.stroke(); return; }
      cats.forEach(function(c, i){
        var v = by[c]; if(!v) return;
        var s = v / total * Math.PI * 2;
        x.beginPath(); x.moveTo(w/2, h/2); x.arc(w/2, h/2, r, a, a + s); x.closePath(); x.fillStyle = colors[i]; x.fill(); a += s;
        var li = document.createElement("li"), dot = document.createElement("i"), t = document.createElement("span");
        dot.style.background = colors[i]; t.textContent = c + " · " + money(v) + " (" + Math.round(v / total * 100) + "%)";
        li.append(dot, t); leg.appendChild(li);
      });
      x.beginPath(); x.arc(w/2, h/2, r * .55, 0, Math.PI*2);
      x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim(); x.fill();
    }
    $("#f").onsubmit = function(e){
      e.preventDefault();
      var amt = parseFloat($("#amt").value); if(!(amt > 0)) return;
      items.push({ desc:$("#desc").value.trim() || sel.value, amount:Math.round(amt * 100) / 100, cat:sel.value, at:Date.now() });
      S.set("items", items); $("#desc").value = ""; $("#amt").value = ""; $("#desc").focus(); draw();
    };
    draw();
  }
};

T.notes = {
  name:"Markdown notes", title:"Notes", w:1000, accent:"#eab308",
  words:["note","notes","markdown","journal","diary","notepad","notebook","memo"],
  html:function(m){ return head(m, "Write in markdown, search everything.") +
    '<div class="notes"><aside class="card"><div class="row"><input id="q" placeholder="Search notes" aria-label="Search notes"><button id="new" aria-label="New note">+</button></div><ul id="nlist" class="nlist"></ul></aside>' +
    '<section class="card"><div class="row between"><span class="muted small">Markdown · # heading, **bold**, *italic*, - list, `code`</span><button id="del" class="ghost">Delete</button></div>' +
    '<div class="split"><textarea id="ed" aria-label="Note text"></textarea><div id="prev" class="prev"></div></div></section></div>'; },
  css:".notes{display:grid;grid-template-columns:240px 1fr;gap:16px}@media(max-width:760px){.notes{grid-template-columns:1fr}}" +
      ".nlist{margin-top:12px}.nlist li{padding:8px 10px;border-radius:calc(var(--r)*.5);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nlist li:hover{background:var(--line)}.nlist li.on{background:var(--accent);color:var(--on)}" +
      ".split{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}@media(max-width:760px){.split{grid-template-columns:1fr}}" +
      "textarea{min-height:420px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:.9em;line-height:1.6}.prev{padding:4px 8px;overflow-wrap:anywhere}" +
      ".prev h1{font-size:1.6em}.prev code{background:var(--line);padding:.1em .35em;border-radius:4px}.prev ul{list-style:disc;padding-left:1.4em}",
  js:function(CFG){
    var notes = S.get("notes", [{ id:1, body:"# Welcome\n\nWrite in **markdown**:\n\n- lists\n- *italics*\n- `code`", at:Date.now() }]);
    var cur = notes[0] ? notes[0].id : null;
    function esc(s){ return s.replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
    function inline(s){
      return s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }
    function md(src){
      var out = [], inList = false;
      esc(src).split("\n").forEach(function(l){
        var m = /^(#{1,3})\s+(.*)/.exec(l), li = /^[-*]\s+(.*)/.exec(l);
        if(!li && inList){ out.push("</ul>"); inList = false; }
        if(m) out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">");
        else if(li){ if(!inList){ out.push("<ul>"); inList = true; } out.push("<li>" + inline(li[1]) + "</li>"); }
        else if(l.trim()) out.push("<p>" + inline(l) + "</p>");
      });
      if(inList) out.push("</ul>");
      return out.join("");
    }
    function title(b){ return ((b.split("\n").filter(function(l){ return l.trim(); })[0]) || "Untitled").replace(/^#+\s*/, "").slice(0, 40); }
    function get(){ return notes.filter(function(n){ return n.id === cur; })[0]; }
    function list(){
      var q = $("#q").value.toLowerCase(), ul = $("#nlist"); ul.innerHTML = "";
      notes.filter(function(n){ return !q || n.body.toLowerCase().indexOf(q) >= 0; })
        .sort(function(a, b){ return b.at - a.at; })
        .forEach(function(n){
          var li = document.createElement("li"); li.className = n.id === cur ? "on" : ""; li.textContent = title(n.body); li.tabIndex = 0;
          li.onclick = function(){ cur = n.id; open(); };
          li.onkeydown = function(e){ if(e.key === "Enter") li.onclick(); };
          ul.appendChild(li);
        });
    }
    function open(){ var n = get(); $("#ed").value = n ? n.body : ""; $("#ed").disabled = !n; $("#prev").innerHTML = n ? md(n.body) : ""; list(); }
    $("#ed").oninput = function(){
      var n = get(); if(!n) return;
      n.body = $("#ed").value; n.at = Date.now(); S.set("notes", notes); $("#prev").innerHTML = md(n.body); list();
    };
    $("#new").onclick = function(){ var n = { id:Date.now(), body:"# New note\n\n", at:Date.now() }; notes.push(n); cur = n.id; S.set("notes", notes); open(); $("#ed").focus(); };
    $("#del").onclick = function(){ if(!get()) return; notes = notes.filter(function(n){ return n.id !== cur; }); cur = notes[0] ? notes[0].id : null; S.set("notes", notes); open(); };
    $("#q").oninput = list;
    open();
  }
};

T.snake = {
  name:"Snake game", title:"Snake", w:460, accent:"#22c55e",
  words:["snake","game","arcade"],
  html:function(m){ return head(m, "Eat, grow, don't bite your tail.") +
    '<div class="card center"><div class="row between stats"><span>Score <b id="score">0</b></span><span>Best <b id="best">0</b></span></div>' +
    '<canvas id="board" width="400" height="400" aria-label="Game board"></canvas><p id="msg" class="muted"></p><button id="start">Start</button>' +
    '<p class="muted small">Arrow keys / WASD or swipe · Space to pause</p></div>'; },
  css:".stats{margin-bottom:10px}canvas{width:100%;max-width:400px;aspect-ratio:1;border-radius:calc(var(--r)*.6);touch-action:none;display:block;margin:0 auto}#msg{min-height:1.5em}",
  js:function(CFG){
    var cv = $("#board"), x = cv.getContext("2d"), N = 20, sz = cv.width / N;
    var snake, dir, next, food, score, best = S.get("best", 0), timer = null, speed = 120, over = false;
    function color(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
    function msg(t){ $("#msg").textContent = t; }
    function place(){
      do { food = { x:Math.floor(Math.random()*N), y:Math.floor(Math.random()*N) }; }
      while(snake.some(function(s){ return s.x === food.x && s.y === food.y; }));
    }
    function reset(){ snake = [{x:9,y:10},{x:8,y:10},{x:7,y:10}]; dir = {x:1,y:0}; next = dir; score = 0; speed = 120; over = false; place(); draw(); msg("Press an arrow key or Start"); }
    function restart(){ clearInterval(timer); timer = setInterval(step, speed); }
    function end(){ clearInterval(timer); timer = null; over = true; msg("Game over · score " + score + " · press Start"); $("#start").textContent = "Start"; draw(); }
    function step(){
      dir = next;
      var h = { x:snake[0].x + dir.x, y:snake[0].y + dir.y };
      if(h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || snake.some(function(s){ return s.x === h.x && s.y === h.y; })) return end();
      snake.unshift(h);
      if(h.x === food.x && h.y === food.y){
        score++; if(score > best){ best = score; S.set("best", best); }
        place(); if(speed > 60){ speed -= 4; restart(); }
      }else snake.pop();
      draw();
    }
    function draw(){
      x.fillStyle = color("--card"); x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = color("--line");
      for(var i = 0; i < N; i++) for(var j = 0; j < N; j++) if((i + j) % 2) x.fillRect(i*sz, j*sz, sz, sz);
      x.fillStyle = "#ef4444"; x.beginPath(); x.arc(food.x*sz + sz/2, food.y*sz + sz/2, sz*.38, 0, Math.PI*2); x.fill();
      x.fillStyle = color("--accent");
      snake.forEach(function(s, i){ x.globalAlpha = i ? .8 : 1; x.fillRect(s.x*sz + 1, s.y*sz + 1, sz - 2, sz - 2); });
      x.globalAlpha = 1;
      $("#score").textContent = score; $("#best").textContent = best;
    }
    function play(){
      if(over) reset();
      if(timer){ clearInterval(timer); timer = null; $("#start").textContent = "Resume"; msg("Paused"); }
      else { restart(); $("#start").textContent = "Pause"; msg(""); }
    }
    function turn(dx, dy){
      if(over) return;
      if(dx === -dir.x && dy === -dir.y) return;
      next = { x:dx, y:dy };
      if(!timer) play();
    }
    document.addEventListener("keydown", function(e){
      var k = e.key.toLowerCase(), d = { arrowup:[0,-1], w:[0,-1], arrowdown:[0,1], s:[0,1], arrowleft:[-1,0], a:[-1,0], arrowright:[1,0], d:[1,0] }[k];
      if(d){ e.preventDefault(); turn(d[0], d[1]); }
      else if(k === " "){ e.preventDefault(); play(); }
    });
    var t0 = null;
    cv.addEventListener("touchstart", function(e){ t0 = e.touches[0]; }, { passive:true });
    cv.addEventListener("touchend", function(e){
      if(!t0) return;
      var t = e.changedTouches[0], dx = t.clientX - t0.clientX, dy = t.clientY - t0.clientY;
      if(Math.max(Math.abs(dx), Math.abs(dy)) > 20){ if(Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0); else turn(0, dy > 0 ? 1 : -1); }
      t0 = null;
    });
    $("#start").onclick = play;
    reset();
  }
};

T.tictactoe = {
  name:"Tic-tac-toe", title:"Tic-Tac-Toe", w:420, accent:"#8b5cf6",
  words:["tic tac toe","tic-tac-toe","tictactoe","noughts","crosses","xo game"],
  html:function(m){ return head(m, "Play the computer or a friend.") +
    '<div class="card center"><div class="row between"><label>Mode <select id="mode"><option value="ai">vs computer</option><option value="2p">2 players</option></select></label><button id="reset" class="ghost">New game</button></div>' +
    '<p id="status" class="status"></p><div id="grid" class="grid"></div>' +
    '<div class="row between score"><span>X <b id="sx">0</b></span><span>Draws <b id="sd">0</b></span><span>O <b id="so">0</b></span></div></div>'; },
  css:".status{font-weight:600;min-height:1.5em}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:330px;margin:12px auto 16px}" +
      ".cell{aspect-ratio:1;font-size:2.4em;font-weight:800;padding:0;background:var(--bg);color:var(--fg);border:1px solid var(--line)}.cell[data-p=X]{color:var(--accent)}.cell[data-p=O]{color:var(--muted)}.cell.win{background:var(--accent);color:var(--on)}",
  js:function(CFG){
    var b, turn, over, vsAI = true, score = S.get("score", { X:0, O:0, D:0 }), cells = [];
    var L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for(var i = 0; i < 9; i++) (function(i){
      var c = document.createElement("button"); c.className = "cell"; c.setAttribute("aria-label", "Square " + (i + 1));
      c.onclick = function(){ move(i); }; $("#grid").appendChild(c); cells.push(c);
    })(i);
    function win(bd){
      for(var k = 0; k < L.length; k++){ var l = L[k]; if(bd[l[0]] && bd[l[0]] === bd[l[1]] && bd[l[0]] === bd[l[2]]) return { p:bd[l[0]], line:l }; }
      return bd.every(function(v){ return v; }) ? { p:"D" } : null;
    }
    function minimax(bd, p){
      var w = win(bd); if(w) return { s:w.p === "O" ? 1 : w.p === "X" ? -1 : 0 };
      var best = { s:p === "O" ? -2 : 2 };
      for(var i = 0; i < 9; i++) if(!bd[i]){
        bd[i] = p; var r = minimax(bd, p === "O" ? "X" : "O"); bd[i] = "";
        if(p === "O" ? r.s > best.s : r.s < best.s) best = { s:r.s, i:i };
      }
      return best;
    }
    function draw(){
      cells.forEach(function(c, k){ c.textContent = b[k]; c.dataset.p = b[k]; c.setAttribute("aria-label", "Square " + (k + 1) + (b[k] ? ": " + b[k] : "")); });
      $("#sx").textContent = score.X; $("#so").textContent = score.O; $("#sd").textContent = score.D;
    }
    function put(i){
      b[i] = turn;
      var w = win(b);
      if(w){
        over = true; score[w.p]++; S.set("score", score);
        $("#status").textContent = w.p === "D" ? "It's a draw" : w.p + " wins!";
        if(w.line) w.line.forEach(function(k){ cells[k].classList.add("win"); });
      }else{
        turn = turn === "X" ? "O" : "X";
        $("#status").textContent = vsAI && turn === "O" ? "Computer is thinking…" : turn + " to play";
      }
      draw();
    }
    function move(i){
      if(over || b[i] || (vsAI && turn === "O")) return;
      put(i);
      if(!over && vsAI) setTimeout(function(){ put(minimax(b.slice(), "O").i); }, 300);
    }
    function reset(){ b = ["","","","","","","","",""]; turn = "X"; over = false; cells.forEach(function(c){ c.classList.remove("win"); }); $("#status").textContent = "X to play"; draw(); }
    $("#reset").onclick = reset;
    $("#mode").onchange = function(){ vsAI = $("#mode").value === "ai"; reset(); };
    reset();
  }
};

T.memory = {
  name:"Memory matching game", title:"Memory Match", w:480, accent:"#ec4899",
  words:["memory game","memory","matching","match pairs","pairs","concentration","card game"],
  html:function(m){ return head(m, "Flip two cards at a time and find every pair.") +
    '<div class="card center"><div class="row between stats"><span>Moves <b id="moves">0</b></span><span>Time <b id="time">0s</b></span><span>Best <b id="best">—</b></span></div>' +
    '<div id="grid" class="grid4"></div><p id="msg" class="win"></p><button id="restart" class="ghost">Restart</button></div>'; },
  css:".stats{margin-bottom:14px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}" +
      ".mcard{aspect-ratio:1;font-size:2em;background:var(--accent);border-radius:calc(var(--r)*.7);padding:0}.mcard span{opacity:0;transition:opacity .15s}" +
      ".mcard.up{background:var(--bg);border:1px solid var(--line)}.mcard.up span{opacity:1}.mcard.done{background:transparent;border:2px solid var(--accent)}.win{font-weight:700;min-height:1.5em}",
  js:function(CFG){
    var icons = ["🍎","🚀","🎧","🌵","🐙","⚽","🎲","🌙"];
    var first = null, lock = false, moves = 0, found = 0, t0 = 0, tick = null, best = S.get("best", null);
    function shuffle(a){ for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function upd(){ $("#moves").textContent = moves; $("#best").textContent = best === null ? "—" : best; }
    function start(){
      var g = $("#grid"); g.innerHTML = ""; first = null; lock = false; moves = 0; found = 0; t0 = 0; clearInterval(tick);
      $("#time").textContent = "0s"; $("#msg").textContent = "";
      shuffle(icons.concat(icons)).forEach(function(ic){
        var c = document.createElement("button"); c.className = "mcard"; c.dataset.v = ic; c.setAttribute("aria-label", "Hidden card");
        var s = document.createElement("span"); s.textContent = ic; c.appendChild(s);
        c.onclick = function(){ flip(c); }; g.appendChild(c);
      });
      upd();
    }
    function hide(c){ c.classList.remove("up"); c.setAttribute("aria-label", "Hidden card"); }
    function flip(c){
      if(lock || c === first || c.classList.contains("up")) return;
      if(!t0){ t0 = Date.now(); tick = setInterval(function(){ $("#time").textContent = Math.round((Date.now() - t0) / 1000) + "s"; }, 500); }
      c.classList.add("up"); c.setAttribute("aria-label", c.dataset.v);
      if(!first){ first = c; return; }
      moves++; upd();
      if(first.dataset.v === c.dataset.v){
        first.classList.add("done"); c.classList.add("done"); first = null; found++;
        if(found === icons.length){
          clearInterval(tick);
          if(best === null || moves < best){ best = moves; S.set("best", best); }
          upd(); $("#msg").textContent = "You won in " + moves + " moves!";
        }
      }else{
        lock = true; var a = first; first = null;
        setTimeout(function(){ hide(a); hide(c); lock = false; }, 800);
      }
    }
    $("#restart").onclick = start;
    start();
  }
};

T.habit = {
  name:"Habit tracker", title:"Habit Tracker", w:640, accent:"#f59e0b",
  words:["habit","habits","streak","streaks","routine","daily goals"],
  html:function(m){ return head(m, "Tick off each day and keep your streaks alive.") +
    '<div class="card"><form id="f" class="row"><input id="name" placeholder="New habit, e.g. Walk 10 minutes" aria-label="New habit"><button>Add</button></form>' +
    '<div class="scroll"><div id="head" class="hrow headrow"></div><div id="rows"></div></div></div>'; },
  css:".scroll{overflow-x:auto;margin-top:16px}.hrow{display:grid;grid-template-columns:minmax(140px,1fr) repeat(7,38px) 44px;align-items:center;gap:4px;padding:6px 0;border-bottom:1px solid var(--line)}" +
      ".headrow{color:var(--muted);font-size:.8em;text-align:center}.headrow small{display:block}.hname{display:flex;align-items:center;gap:4px;overflow-wrap:anywhere}" +
      ".tick{width:32px;height:32px;padding:0;margin:auto;border-radius:50%;background:var(--bg);border:1px solid var(--line)}.tick.on{background:var(--accent);border-color:var(--accent)}.streak{text-align:center;font-weight:700}",
  js:function(CFG){
    var habits = S.get("habits", [{ name:"Drink water", days:{} }, { name:"Read 20 minutes", days:{} }]);
    function key(d){ return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
    function days(){ var out = []; for(var i = 6; i >= 0; i--){ var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i); out.push(d); } return out; }
    function streak(h){ var n = 0, d = new Date(); d.setHours(0,0,0,0); if(!h.days[key(d)]) d.setDate(d.getDate() - 1); while(h.days[key(d)]){ n++; d.setDate(d.getDate() - 1); } return n; }
    function save(){ S.set("habits", habits); draw(); }
    function draw(){
      var ds = days(), hd = $("#head"); hd.innerHTML = "<span></span>";
      ds.forEach(function(d){ var s = document.createElement("span"); s.textContent = "SMTWTFS".charAt(d.getDay()); var sm = document.createElement("small"); sm.textContent = d.getDate(); s.appendChild(sm); hd.appendChild(s); });
      var st = document.createElement("span"); st.textContent = "Streak"; hd.appendChild(st);
      var rows = $("#rows"); rows.innerHTML = "";
      habits.forEach(function(h, hi){
        var row = document.createElement("div"); row.className = "hrow";
        var name = document.createElement("span"); name.className = "hname"; name.textContent = h.name;
        var del = document.createElement("button"); del.className = "x"; del.textContent = "×"; del.setAttribute("aria-label", "Remove " + h.name);
        del.onclick = function(){ habits.splice(hi, 1); save(); };
        name.appendChild(del); row.appendChild(name);
        ds.forEach(function(d){
          var k = key(d), b = document.createElement("button");
          b.className = "tick" + (h.days[k] ? " on" : ""); b.setAttribute("aria-pressed", h.days[k] ? "true" : "false");
          b.setAttribute("aria-label", h.name + " on " + d.toDateString());
          b.onclick = function(){ if(h.days[k]) delete h.days[k]; else h.days[k] = 1; save(); };
          row.appendChild(b);
        });
        var s = document.createElement("span"); s.className = "streak"; s.textContent = streak(h); row.appendChild(s);
        rows.appendChild(row);
      });
    }
    $("#f").onsubmit = function(e){ e.preventDefault(); var v = $("#name").value.trim(); if(!v) return; habits.push({ name:v, days:{} }); $("#name").value = ""; save(); };
    draw();
  }
};

T.converter = {
  name:"Unit converter", title:"Unit Converter", w:560, accent:"#14b8a6",
  words:["convert","converter","conversion","units","unit","celsius","fahrenheit","kilometers","miles"],
  html:function(m){ return head(m, "Length, weight, volume, speed and temperature.") +
    '<div class="card"><label class="cat">Category <select id="cat"></select></label><div class="conv">' +
    '<div class="side"><input id="a" type="number" aria-label="Value to convert"><select id="ua" aria-label="From unit"></select></div>' +
    '<button id="swap" class="ghost" aria-label="Swap units">⇄</button>' +
    '<div class="side"><input id="b" type="number" aria-label="Converted value"><select id="ub" aria-label="To unit"></select></div></div></div>'; },
  css:".cat{display:flex;gap:10px;align-items:center;margin-bottom:16px}.conv{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center}@media(max-width:520px){.conv{grid-template-columns:1fr}}" +
      ".side{display:grid;gap:8px}.side input{font-size:1.4em;font-weight:600}",
  js:function(CFG){
    var U = {
      Length:{ m:1, km:1000, cm:.01, mm:.001, mi:1609.344, yd:.9144, ft:.3048, "in":.0254 },
      Weight:{ kg:1, g:.001, mg:1e-6, lb:.45359237, oz:.028349523125, t:1000 },
      Volume:{ l:1, ml:.001, gal:3.785411784, qt:.946352946, cup:.2365882365, "fl oz":.0295735295625 },
      Speed:{ "m/s":1, "km/h":1/3.6, mph:.44704, knot:.514444 },
      Temperature:{ "°C":1, "°F":1, K:1 }
    };
    var cat = $("#cat"), a = $("#a"), b = $("#b"), ua = $("#ua"), ub = $("#ub");
    Object.keys(U).forEach(function(k){ var o = document.createElement("option"); o.textContent = k; cat.appendChild(o); });
    function toC(v, u){ return u === "°C" ? v : u === "°F" ? (v - 32) * 5 / 9 : v - 273.15; }
    function fromC(v, u){ return u === "°C" ? v : u === "°F" ? v * 9 / 5 + 32 : v + 273.15; }
    function conv(v, from, to){ if(cat.value === "Temperature") return fromC(toC(v, from), to); var t = U[cat.value]; return v * t[from] / t[to]; }
    function fmt(n){ return isFinite(n) ? String(parseFloat(n.toPrecision(10))) : ""; }
    function go(src){
      if(src === "a"){ var v = parseFloat(a.value); b.value = isNaN(v) ? "" : fmt(conv(v, ua.value, ub.value)); }
      else { var w = parseFloat(b.value); a.value = isNaN(w) ? "" : fmt(conv(w, ub.value, ua.value)); }
    }
    function fill(){
      var units = Object.keys(U[cat.value]);
      [ua, ub].forEach(function(s, i){ s.innerHTML = ""; units.forEach(function(u){ var o = document.createElement("option"); o.textContent = u; s.appendChild(o); }); s.selectedIndex = Math.min(i, units.length - 1); });
      go("a");
    }
    cat.onchange = fill;
    a.oninput = function(){ go("a"); }; b.oninput = function(){ go("b"); };
    ua.onchange = function(){ go("a"); }; ub.onchange = function(){ go("a"); };
    $("#swap").onclick = function(){ var t = ua.value; ua.value = ub.value; ub.value = t; go("a"); };
    cat.value = U[CFG.unitCat] ? CFG.unitCat : "Length"; a.value = 1; fill();
  }
};

T.drawing = {
  name:"Drawing pad", title:"Sketchpad", w:960, accent:"#3b82f6",
  words:["draw","drawing","paint","painting","sketch","sketchpad","whiteboard","doodle"],
  html:function(m){ return head(m, "Draw with a mouse, pen or finger.") +
    '<div class="card"><div class="toolbar"><label>Colour <input id="color" type="color"></label><label>Size <input id="size" type="range" min="1" max="40" value="6"></label>' +
    '<button id="eraser" class="ghost" aria-pressed="false">Eraser</button><button id="clear" class="ghost">Clear</button><button id="save">Save PNG</button></div><canvas id="pad" aria-label="Drawing canvas"></canvas></div>'; },
  css:".toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.toolbar label{display:flex;gap:6px;align-items:center}.toolbar input[type=color]{padding:0;width:40px;height:34px}" +
      "#eraser.on{background:var(--accent);color:var(--on);border-color:var(--accent)}#pad{width:100%;height:min(70vh,560px);display:block;border-radius:calc(var(--r)*.6);touch-action:none;cursor:crosshair;background:#fff}",
  js:function(CFG){
    var cv = $("#pad"), x = cv.getContext("2d"), drawing = false, last = null, erase = false;
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round((r.width || 800) * dpr); cv.height = Math.round((r.height || 500) * dpr); x.scale(dpr, dpr);
    function bg(){ x.save(); x.setTransform(1,0,0,1,0,0); x.fillStyle = "#ffffff"; x.fillRect(0, 0, cv.width, cv.height); x.restore(); }
    function pos(e){ var b = cv.getBoundingClientRect(); return { x:e.clientX - b.left, y:e.clientY - b.top }; }
    function ink(){ return erase ? "#ffffff" : $("#color").value; }
    cv.onpointerdown = function(e){
      drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId);
      x.beginPath(); x.arc(last.x, last.y, $("#size").value / 2, 0, Math.PI*2); x.fillStyle = ink(); x.fill();
    };
    cv.onpointermove = function(e){
      if(!drawing) return;
      var p = pos(e);
      x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(p.x, p.y);
      x.strokeStyle = ink(); x.lineWidth = +$("#size").value; x.lineCap = "round"; x.lineJoin = "round"; x.stroke();
      last = p;
    };
    cv.onpointerup = cv.onpointercancel = function(){ drawing = false; };
    $("#eraser").onclick = function(){ erase = !erase; this.classList.toggle("on", erase); this.setAttribute("aria-pressed", String(erase)); };
    $("#clear").onclick = bg;
    $("#save").onclick = function(){ var a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "drawing.png"; document.body.appendChild(a); a.click(); a.remove(); };
    $("#color").value = CFG.accent; bg();
  }
};

T.countdown = {
  name:"Countdown", title:"Countdown", w:620, accent:"#f43f5e",
  words:["countdown","count down","days until","days left","event timer","new year"],
  html:function(m){ return head(m, "Counting down to the moment that matters.") +
    '<div class="card center"><p id="label" class="muted"></p><div class="units"><div><b id="d">0</b><span>days</span></div><div><b id="h">00</b><span>hours</span></div>' +
    '<div><b id="m">00</b><span>minutes</span></div><div><b id="s">00</b><span>seconds</span></div></div>' +
    '<div class="settings"><label>Event <input id="ev"></label><label>Date <input id="when" type="datetime-local"></label></div></div>'; },
  css:".units{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 20px}.units div{background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--r)*.7);padding:14px 4px}" +
      ".units b{display:block;font-size:2.4em;font-variant-numeric:tabular-nums;color:var(--accent)}.units span{color:var(--muted);font-size:.8em;text-transform:uppercase;letter-spacing:.1em}" +
      ".settings{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}.settings label{display:flex;gap:6px;align-items:center}",
  js:function(CFG){
    var target = S.get("target", null), name = S.get("name", CFG.title);
    if(!target){ var d0 = new Date(); d0.setDate(d0.getDate() + 30); d0.setHours(0,0,0,0); target = d0.getTime(); }
    function toLocal(ms){ var d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
    function p(n){ return (n < 10 ? "0" : "") + n; }
    function tick(){
      var ms = target - Date.now(), past = ms < 0; ms = Math.abs(ms);
      $("#d").textContent = Math.floor(ms / 864e5); $("#h").textContent = p(Math.floor(ms / 36e5) % 24);
      $("#m").textContent = p(Math.floor(ms / 6e4) % 60); $("#s").textContent = p(Math.floor(ms / 1e3) % 60);
      $("#label").textContent = (past ? "Time since " : "Time until ") + (name === "Countdown" ? "the big day" : name);
    }
    $("#when").value = toLocal(target); $("#ev").value = name;
    $("#when").onchange = function(){ var v = new Date($("#when").value).getTime(); if(!isNaN(v)){ target = v; S.set("target", v); tick(); } };
    $("#ev").oninput = function(){ name = $("#ev").value || CFG.title; S.set("name", name); tick(); };
    tick(); setInterval(tick, 1000);
  }
};

T.password = {
  name:"Password generator", title:"Password Generator", w:520, accent:"#6366f1",
  words:["password","passphrase","passwords"],
  html:function(m){ return head(m, "Strong random passwords, made in your browser.") +
    '<div class="card"><div class="row"><input id="out" readonly aria-label="Generated password" class="mono"><button id="copy">Copy</button></div>' +
    '<div class="bar"><i id="meter"></i></div><p id="str" class="muted small"></p>' +
    '<label class="len">Length <b id="lenv"></b><input id="len" type="range" min="8" max="64" value="16"></label>' +
    '<div class="opts"><label><input type="checkbox" id="lower" checked> Lowercase</label><label><input type="checkbox" id="upper" checked> Uppercase</label>' +
    '<label><input type="checkbox" id="digits" checked> Numbers</label><label><input type="checkbox" id="symbols" checked> Symbols</label></div>' +
    '<button id="again" class="ghost">Generate another</button></div>'; },
  css:".mono{font-family:ui-monospace,Consolas,monospace;font-size:1.1em}.bar{height:6px;background:var(--line);border-radius:3px;margin:14px 0 6px;overflow:hidden}.bar i{display:block;height:100%;transition:width .2s}" +
      ".len{display:grid;gap:6px;margin:16px 0}.len input{padding:0}.opts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.opts input{accent-color:var(--accent)}",
  js:function(CFG){
    var sets = { lower:"abcdefghijkmnopqrstuvwxyz", upper:"ABCDEFGHJKLMNPQRSTUVWXYZ", digits:"23456789", symbols:"!@#$%^&*()-_=+[]{};:,.?" };
    function rnd(n){ var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
    function strength(len, size){
      var bits = Math.round(len * Math.log2(size));
      var l = bits < 40 ? ["Weak","#ef4444",25] : bits < 64 ? ["Fair","#f59e0b",50] : bits < 90 ? ["Strong","#22c55e",75] : ["Very strong","#16a34a",100];
      $("#meter").style.width = l[2] + "%"; $("#meter").style.background = l[1]; $("#str").textContent = l[0] + " · about " + bits + " bits";
    }
    function gen(){
      var len = +$("#len").value, pool = "", out = [];
      $("#lenv").textContent = len;
      Object.keys(sets).forEach(function(k){ if($("#" + k).checked){ pool += sets[k]; out.push(sets[k].charAt(rnd(sets[k].length))); } });
      if(!pool){ $("#out").value = ""; $("#str").textContent = "Pick at least one character type."; return; }
      while(out.length < len) out.push(pool.charAt(rnd(pool.length)));
      for(var i = out.length - 1; i > 0; i--){ var j = rnd(i + 1), t = out[i]; out[i] = out[j]; out[j] = t; }
      $("#out").value = out.join(""); strength(len, pool.length);
    }
    $("#copy").onclick = function(){
      var o = $("#out"), btn = $("#copy");
      function done(){ btn.textContent = "Copied"; setTimeout(function(){ btn.textContent = "Copy"; }, 1200); }
      function legacy(){ o.select(); try{ document.execCommand("copy"); done(); }catch(e){} }
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.value).then(done, legacy); else legacy();
    };
    ["len","lower","upper","digits","symbols"].forEach(function(id){ $("#" + id).oninput = gen; });
    $("#again").onclick = gen;
    gen();
  }
};

T.kanban = {
  name:"Kanban board", title:"Project Board", w:1100, accent:"#0ea5e9",
  words:["kanban","board","trello","project board","project management","sprint","scrum"],
  html:function(m){ return head(m, "Drag cards between columns, or use the arrows.") + '<div id="board" class="board"></div>'; },
  css:".board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}@media(max-width:760px){.board{grid-template-columns:1fr}}" +
      ".col h2{font-size:1em;margin:0 0 12px}.col.over{outline:2px dashed var(--accent)}.col ul{display:grid;gap:8px;min-height:20px}" +
      ".kcard{display:flex;gap:6px;align-items:flex-start;justify-content:space-between;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:calc(var(--r)*.6);cursor:grab}" +
      ".kcard span{overflow-wrap:anywhere}.kcard.dragging{opacity:.4}.kacts{display:flex;flex:none}.kacts .x{font-size:1em}.add{display:flex;gap:6px;margin-top:10px}.add input{flex:1}",
  js:function(CFG){
    var cols = ["To do","Doing","Done"], drag = null;
    var cards = S.get("cards", [{ id:1, text:"Plan the week", col:0 }, { id:2, text:"Write the first draft", col:1 }, { id:3, text:"Set up the board", col:2 }]);
    function save(){ S.set("cards", cards); draw(); }
    function btn(t, label, fn){ var b = document.createElement("button"); b.textContent = t; b.className = "x"; b.setAttribute("aria-label", label); b.onclick = fn; return b; }
    function draw(){
      var board = $("#board"); board.innerHTML = "";
      cols.forEach(function(name, ci){
        var mine = cards.filter(function(c){ return c.col === ci; });
        var col = document.createElement("section"); col.className = "col card";
        var h = document.createElement("h2"); h.textContent = name + " (" + mine.length + ")"; col.appendChild(h);
        var ul = document.createElement("ul"); col.appendChild(ul);
        mine.forEach(function(c){
          var li = document.createElement("li"); li.className = "kcard"; li.draggable = true;
          var t = document.createElement("span"); t.textContent = c.text; li.appendChild(t);
          var acts = document.createElement("div"); acts.className = "kacts";
          if(ci > 0) acts.appendChild(btn("←", "Move to " + cols[ci-1], function(){ c.col--; save(); }));
          if(ci < cols.length - 1) acts.appendChild(btn("→", "Move to " + cols[ci+1], function(){ c.col++; save(); }));
          acts.appendChild(btn("×", "Delete", function(){ cards = cards.filter(function(x){ return x !== c; }); save(); }));
          li.appendChild(acts);
          li.ondragstart = function(){ drag = c; li.classList.add("dragging"); };
          li.ondragend = function(){ li.classList.remove("dragging"); };
          ul.appendChild(li);
        });
        col.ondragover = function(e){ e.preventDefault(); col.classList.add("over"); };
        col.ondragleave = function(){ col.classList.remove("over"); };
        col.ondrop = function(e){ e.preventDefault(); col.classList.remove("over"); if(drag){ drag.col = ci; drag = null; save(); } };
        var f = document.createElement("form"); f.className = "add";
        var inp = document.createElement("input"); inp.placeholder = "Add a card"; inp.setAttribute("aria-label", "Add a card to " + name);
        var add = document.createElement("button"); add.textContent = "+"; add.setAttribute("aria-label", "Add");
        f.append(inp, add);
        f.onsubmit = function(e){ e.preventDefault(); var v = inp.value.trim(); if(!v) return; cards.push({ id:Date.now(), text:v, col:ci }); save(); };
        col.appendChild(f); board.appendChild(col);
      });
    }
    draw();
  }
};

T.quiz = {
  name:"Quiz", title:"Quick Quiz", w:620, accent:"#8b5cf6",
  words:["quiz","trivia","questions","test yourself","flashcard"],
  html:function(m){ return head(m, "Ten general-knowledge questions. How many can you get?") +
    '<div class="card"><div class="bar"><i id="bar"></i></div><div id="qa"><p id="n" class="muted small"></p><h2 id="q"></h2><div id="answers" class="answers"></div>' +
    '<button id="next" hidden>Next</button></div><div id="end" class="center" hidden><p class="muted">Your score</p><div class="big" id="final"></div>' +
    '<p class="muted">Best: <b id="bestq">0</b></p><button id="again">Play again</button></div></div>'; },
  css:".bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:16px}.bar i{display:block;height:100%;background:var(--accent);transition:width .3s}" +
      "h2{font-size:1.3em;margin:6px 0 16px}.answers{display:grid;gap:8px;margin-bottom:16px}.ans{text-align:left;background:var(--bg);color:var(--fg);border:1px solid var(--line);font-weight:500}" +
      ".ans.right{background:#16a34a;color:#fff;border-color:#16a34a}.ans.wrong{background:#dc2626;color:#fff;border-color:#dc2626}.ans:disabled{opacity:1}.big{font-size:3em;font-weight:800}",
  js:function(CFG){
    var Q = [
      ["What is the largest planet in our solar system?", ["Earth","Jupiter","Saturn","Neptune"], 1],
      ["Which element has the chemical symbol O?", ["Gold","Oxygen","Osmium","Iron"], 1],
      ["How many continents are there?", ["5","6","7","8"], 2],
      ["Who painted the Mona Lisa?", ["Van Gogh","Picasso","Leonardo da Vinci","Monet"], 2],
      ["At sea level, water boils at how many °C?", ["90","100","110","120"], 1],
      ["Which ocean is the largest?", ["Atlantic","Indian","Arctic","Pacific"], 3],
      ["How many sides does a hexagon have?", ["5","6","7","8"], 1],
      ["What gas do plants take in from the air?", ["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"], 2],
      ["Which is the fastest land animal?", ["Cheetah","Lion","Horse","Gazelle"], 0],
      ["What is 9 × 7?", ["56","63","72","81"], 1]
    ];
    var order, i, score, best = S.get("best", 0);
    function show(){
      var q = Q[order[i]];
      $("#n").textContent = "Question " + (i + 1) + " of " + Q.length; $("#bar").style.width = (i / Q.length * 100) + "%"; $("#q").textContent = q[0];
      var a = $("#answers"); a.innerHTML = "";
      q[1].forEach(function(t, k){ var b = document.createElement("button"); b.className = "ans"; b.textContent = t; b.onclick = function(){ pick(k, b); }; a.appendChild(b); });
      $("#next").hidden = true;
    }
    function pick(k, b){
      var q = Q[order[i]];
      document.querySelectorAll(".ans").forEach(function(x, j){ x.disabled = true; if(j === q[2]) x.classList.add("right"); });
      if(k === q[2]) score++; else b.classList.add("wrong");
      $("#next").hidden = false; $("#next").focus();
    }
    function finish(){
      $("#bar").style.width = "100%"; if(score > best){ best = score; S.set("best", best); }
      $("#qa").hidden = true; $("#end").hidden = false; $("#final").textContent = score + " / " + Q.length; $("#bestq").textContent = best;
    }
    function start(){ order = Q.map(function(q, k){ return k; }).sort(function(){ return Math.random() - .5; }); i = 0; score = 0; $("#end").hidden = true; $("#qa").hidden = false; show(); }
    $("#next").onclick = function(){ i++; if(i < Q.length) show(); else finish(); };
    $("#again").onclick = start;
    start();
  }
};

/* landing pages: copy adapts to the kind of business the prompt describes */
var KINDS = {
  cafe:{ words:["coffee","cafe","café","bakery","tea","espresso","brunch"], name:"Corner Café", tagline:"Freshly roasted coffee, homemade bakes and a seat by the window.", cta:"See the menu",
    features:[["Roasted weekly","Small-batch beans from growers we know by name."],["Baked this morning","Pastries and bread made in-house, every day."],["Stay a while","Fast wifi, plenty of plugs and no rush to leave."]],
    listTitle:"Menu", items:[["Flat white","3.20"],["Oat latte","3.60"],["Almond croissant","2.90"],["Seasonal cake","3.40"]], hours:"Mon–Fri 7:00–18:00 · Sat–Sun 8:00–17:00" },
  restaurant:{ words:["restaurant","food","pizza","burger","kitchen","diner","bistro","grill","sushi","eatery"], name:"Harbor Kitchen", tagline:"Seasonal plates, good wine and a table waiting for you.", cta:"Book a table",
    features:[["Seasonal menu","We cook what's fresh, so the menu changes with the market."],["Private dining","A room for twelve for birthdays, teams and celebrations."],["Takeaway","Order ahead and pick up on your way home."]],
    listTitle:"Menu", items:[["Burrata & tomatoes","9.50"],["Wood-fired pizza","13.00"],["Catch of the day","19.00"],["Chocolate tart","7.00"]], hours:"Tue–Sun 12:00–22:30 · Closed Mondays" },
  gym:{ words:["gym","fitness","yoga","trainer","crossfit","pilates","workout","boxing"], name:"Pulse Fitness", tagline:"Train smarter with coaches who know your name.", cta:"Book a free class",
    features:[["Expert coaches","Certified trainers on the floor at every session."],["Classes for all","From first-timer to competition prep."],["Open early","Doors open at 6am so you can train before work."]],
    listTitle:"Classes", items:[["Strength fundamentals","Mon & Wed 18:00"],["HIIT express","Tue & Thu 7:00"],["Yoga flow","Sat 9:30"],["Open gym","Every day"]], hours:"Mon–Fri 6:00–22:00 · Sat–Sun 8:00–18:00" },
  salon:{ words:["salon","barber","hair","beauty","spa","nails","makeup","stylist"], name:"Studio Bloom", tagline:"Cuts, colour and care in a calm, friendly studio.", cta:"Book an appointment",
    features:[["Experienced stylists","Every stylist has years behind the chair."],["Quality products","Gentle, professional products we trust."],["Easy booking","Pick a time that suits you, online or by phone."]],
    listTitle:"Services", items:[["Cut & finish","from 35"],["Colour","from 60"],["Blow-dry","25"],["Beard trim","15"]], hours:"Tue–Sat 9:00–19:00" },
  shop:{ words:["shop","store","boutique","clothing","fashion","ecommerce","e-commerce","products","merch"], name:"Northwind Goods", tagline:"Well-made things for everyday life.", cta:"Shop the collection",
    features:[["Made to last","Products chosen for quality, not trends."],["Free returns","Changed your mind? Send it back within 30 days."],["Fast delivery","Orders ship within two working days."]],
    listTitle:"Bestsellers", items:[["Canvas tote","24"],["Ceramic mug","18"],["Wool beanie","22"],["Notebook set","15"]], hours:"Online 24/7 · Showroom Thu–Sat 10:00–18:00" },
  agency:{ words:["agency","studio","design","marketing","consulting","consultancy","creative","branding","law firm","accounting"], name:"Brightside Studio", tagline:"Strategy, design and launch for teams that want to stand out.", cta:"Start a project",
    features:[["Strategy","We start with your goals and your customers."],["Design","Identity, websites and campaigns that feel like you."],["Launch","We ship, measure and keep improving."]],
    listTitle:"Services", items:[["Brand identity","4–6 weeks"],["Website","6–10 weeks"],["Campaigns","Ongoing"],["Workshops","1 day"]], hours:"Mon–Fri 9:00–17:30" },
  portfolio:{ words:["portfolio","personal","resume","cv","freelancer","freelance","photographer","developer site","about me"], name:"Your Name", tagline:"Designer and builder. I make useful things for the web.", cta:"See my work",
    features:[["Design","Clear, accessible interfaces people enjoy using."],["Development","Fast, well-built sites and apps."],["Collaboration","Straightforward, reliable and easy to work with."]],
    listTitle:"Selected work", items:[["Booking app redesign","2026"],["Local café website","2025"],["Data dashboard","2025"],["Open-source toolkit","2024"]], hours:"Available for new projects" },
  startup:{ words:["startup","saas","app landing","product","software","platform","tool"], name:"Launchpad", tagline:"The simplest way to get your work done, together.", cta:"Get started free",
    features:[["Fast setup","Up and running in minutes, no training needed."],["Works everywhere","Desktop, phone and tablet, always in sync."],["Secure by default","Your data is encrypted and stays yours."]],
    listTitle:"Pricing", items:[["Starter","Free"],["Team","8 / user / month"],["Business","16 / user / month"],["Enterprise","Contact us"]], hours:"Support Mon–Fri, 9:00–18:00" },
  general:{ words:[], name:"My Website", tagline:"Welcome. Here's what we do and how to reach us.", cta:"Get in touch",
    features:[["What we do","A short description of your main offer."],["Why us","What makes you different, in one or two lines."],["How it works","The simple steps to get started with you."]],
    listTitle:"Highlights", items:[["First highlight",""],["Second highlight",""],["Third highlight",""],["Fourth highlight",""]], hours:"Mon–Fri 9:00–17:00" }
};

T.landing = {
  name:"Website", title:"My Website", w:1080, accent:"#3b82f6", bodyClass:"site",
  words:["website","site","landing","landing page","web page","homepage","home page","business","company","page for"],
  html:function(m){
    var k = KINDS[m.cfg.kind] || KINDS.general, cur = m.cfg.currency || "";
    var priced = ["cafe","restaurant","salon","shop"].indexOf(m.cfg.kind) >= 0;
    function card(f){ return '<div class="card"><h3>' + esc(f[0]) + '</h3><p class="muted">' + esc(f[1]) + "</p></div>"; }
    function item(it){ return "<li><span>" + esc(it[0]) + "</span><b>" + (it[1] ? esc((priced && /^\d/.test(it[1]) ? cur : "") + it[1]) : "") + "</b></li>"; }
    return '<header class="nav"><a class="brand" href="#">' + esc(m.title) + '</a><nav><a href="#about">About</a><a href="#list">' + esc(k.listTitle) + '</a><a href="#contact">Contact</a></nav></header>' +
      '<section class="hero"><h1>' + esc(m.title) + '</h1><p class="lead">' + esc(k.tagline) + '</p><div class="row ctas"><a class="btn" href="#list">' + esc(k.cta) + '</a><a class="btn ghost" href="#contact">Contact us</a></div></section>' +
      '<section class="features">' + k.features.map(card).join("") + "</section>" +
      '<section id="list" class="split"><div><h2>' + esc(k.listTitle) + '</h2><p class="muted">Edit these to match what you offer.</p></div><ul class="items card">' + k.items.map(item).join("") + "</ul></section>" +
      '<section id="about" class="about card"><h2>About ' + esc(m.title) + '</h2><p class="muted">Tell your story here: who you are, why you started and what customers can expect when they work with you.</p></section>' +
      '<section id="contact" class="split"><div><h2>Visit or get in touch</h2><p class="muted">' + esc(k.hours) + '</p><p class="muted">123 Main Street, Your Town<br>hello@example.com</p></div>' +
      '<form id="contactf" class="card form"><label>Name<input required></label><label>Email<input type="email" required></label><label>Message<textarea rows="4" required></textarea></label><button>Send</button><p id="thanks" class="muted" hidden></p></form></section>' +
      '<footer class="muted small">© <span id="yr"></span> ' + esc(m.title) + "</footer>";
  },
  css:"body.site{display:block;padding:0}.site .app{margin:0 auto;padding:0 20px 40px}" +
      ".nav{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 0;flex-wrap:wrap}.brand{font-weight:800;font-size:1.2em;color:var(--fg);text-decoration:none}" +
      ".nav nav{display:flex;gap:18px}.nav nav a{color:var(--muted);text-decoration:none}.nav nav a:hover{color:var(--fg)}" +
      ".hero{padding:clamp(48px,10vw,110px) 0 56px;text-align:center}.hero h1{font-size:clamp(2.4em,7vw,4.2em)}.lead{font-size:1.2em;color:var(--muted);max-width:620px;margin:0 auto 28px}.ctas{justify-content:center;flex-wrap:wrap}" +
      ".btn{display:inline-block;padding:.75em 1.4em;border-radius:calc(var(--r)*.6);background:var(--accent);color:var(--on);font-weight:700;text-decoration:none}.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}" +
      ".features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:56px}@media(max-width:760px){.features{grid-template-columns:1fr}}.features h3{margin:0 0 6px}" +
      ".split{display:grid;grid-template-columns:1fr 1.2fr;gap:32px;align-items:start;margin-bottom:56px}@media(max-width:760px){.split{grid-template-columns:1fr}}h2{font-size:1.7em;margin:0 0 8px}" +
      ".items li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.items li:last-child{border:0}.about{margin-bottom:56px}" +
      ".form{display:grid;gap:12px}.form label{display:grid;gap:6px;font-size:.9em}footer{padding:24px 0;border-top:1px solid var(--line)}",
  js:function(CFG){
    $("#yr").textContent = new Date().getFullYear();
    $("#contactf").onsubmit = function(e){
      e.preventDefault();
      var t = $("#thanks"); t.hidden = false;
      t.textContent = "Thanks! This demo form doesn't send anything yet. Connect it to an email service or form backend to receive messages.";
      this.reset();
    };
  }
};

/* ---------------- prompt understanding ---------------- */
function lower(s){ return " " + String(s).toLowerCase().replace(/[^\w\sÀ-ɏ'-]/g, " ").replace(/\s+/g, " ") + " "; }
function has(l, w){ return l.indexOf(" " + w + " ") >= 0 || (w.indexOf(" ") > 0 && l.indexOf(w) >= 0); }

function scoreTemplates(text){
  var l = lower(text), best = null, bestScore = 0;
  Object.keys(T).forEach(function(k){
    var s = 0;
    T[k].words.forEach(function(w){ if(has(l, w)) s += w.indexOf(" ") > 0 ? 3 : (w === "game" || w === "timer" || w === "board" || w === "site" ? 1 : 2); });
    if(k === "landing"){
      Object.keys(KINDS).forEach(function(kind){ KINDS[kind].words.forEach(function(w){ if(has(l, w)) s += 1; }); });
      if(s < 2) s = 0;
    }
    if(s > bestScore){ bestScore = s; best = k; }
  });
  return { template:best, score:bestScore };
}

function findTitle(text){
  var m = /(?:called|named|titled|title it|name it|call it)\s+["“']?([^"”'\n,.!?]{2,40})/i.exec(text) || /["“]([^"”]{2,40})["”]/.exec(text);
  return m ? m[1].trim().replace(/\s+(with|and|that|which)\b.*$/i, "") : "";
}
function findColor(text){
  var l = lower(text);
  for(var c in COLORS) if(has(l, c)) return COLORS[c];
  var hex = /#([0-9a-f]{6})\b/i.exec(text);
  return hex ? "#" + hex[1].toLowerCase() : "";
}
function findCurrency(text){
  var l = lower(text);
  if(/€/.test(text) || has(l, "euro") || has(l, "euros")) return "€";
  if(/£/.test(text) || has(l, "pound") || has(l, "pounds") || has(l, "gbp")) return "£";
  if(/₹/.test(text) || has(l, "rupee") || has(l, "rupees") || has(l, "inr")) return "₹";
  if(/₦/.test(text) || has(l, "naira") || has(l, "ngn")) return "₦";
  if(/¥/.test(text) || has(l, "yen")) return "¥";
  if(has(l, "shilling") || has(l, "ksh") || has(l, "kes")) return "KSh ";
  if(has(l, "rand") || has(l, "zar")) return "R";
  return "";
}
function findKind(text){
  var l = lower(text), best = "general", n = 0;
  Object.keys(KINDS).forEach(function(k){
    var s = 0; KINDS[k].words.forEach(function(w){ if(has(l, w)) s++; });
    if(s > n){ n = s; best = k; }
  });
  return best;
}

function newMeta(template, text){
  var t = T[template], l = lower(text);
  var meta = { template:template, title:findTitle(text) || t.title, accent:findColor(text) || t.accent,
               dark:!(has(l, "light") || has(l, "white")), scale:1, radius:14, cfg:{} };
  if(has(l, "dark")) meta.dark = true;
  if(template === "pomodoro"){ var mm = /(\d{1,3})\s*-?\s*min/.exec(l); if(mm) meta.cfg.focus = Math.min(180, +mm[1]); }
  if(template === "expense"){ var c = findCurrency(text); if(c) meta.cfg.currency = c; }
  if(template === "converter"){
    ["Temperature","Weight","Volume","Speed"].forEach(function(k){ if(has(l, k.toLowerCase())) meta.cfg.unitCat = k; });
    if(has(l, "celsius") || has(l, "fahrenheit")) meta.cfg.unitCat = "Temperature";
  }
  if(template === "landing"){
    meta.cfg.kind = findKind(text);
    meta.cfg.currency = findCurrency(text) || "$";
    if(!findTitle(text)) meta.title = KINDS[meta.cfg.kind].name;
    if(!has(l, "dark")) meta.dark = false;
  }
  return meta;
}

/* follow-up edits that work without a model */
function applyEdits(meta, text){
  var l = lower(text), m = JSON.parse(JSON.stringify(meta)), done = [];
  var title = /(?:call it|rename (?:it )?(?:to)?|name it|title (?:it )?|change the (?:title|name) to|set the (?:title|name) to)\s+["“']?([^"”'\n,.!?]{2,40})/i.exec(text);
  if(title){ m.title = title[1].trim(); done.push("renamed it to “" + m.title + "”"); }
  if(/\b(dark (mode|theme|background|version)|make it dark|go dark|darker)\b/.test(l)){ m.dark = true; done.push("switched to a dark theme"); }
  else if(/\b(light (mode|theme|background|version)|make it light|white background|lighter|bright mode)\b/.test(l)){ m.dark = false; done.push("switched to a light theme"); }
  var c = findColor(text.replace(/\b(dark|light)\s+(mode|theme|background)\b/ig, ""));
  if(c && c !== m.accent){ m.accent = c; done.push("changed the accent colour"); }
  if(/\b(bigger|larger|increase|huge)\b.*\b(text|font|size)\b|\b(text|font)\b.*\b(bigger|larger)\b/.test(l)){ m.scale = Math.min(1.6, +(m.scale * 1.15).toFixed(2)); done.push("made the text bigger"); }
  if(/\b(smaller|decrease|tiny)\b.*\b(text|font|size)\b|\b(text|font)\b.*\bsmaller\b/.test(l)){ m.scale = Math.max(.75, +(m.scale / 1.15).toFixed(2)); done.push("made the text smaller"); }
  if(/\b(rounded|round|softer|pill)\b/.test(l)){ m.radius = 22; done.push("rounded the corners"); }
  if(/\b(square|sharp|boxy)\b/.test(l)){ m.radius = 3; done.push("squared off the corners"); }
  if(m.template === "pomodoro"){ var mm = /(\d{1,3})\s*-?\s*min/.exec(l); if(mm){ m.cfg.focus = Math.min(180, +mm[1]); done.push("set focus sessions to " + m.cfg.focus + " minutes"); } }
  if(m.template === "expense" || m.template === "landing"){ var cur = findCurrency(text); if(cur && cur !== m.cfg.currency){ m.cfg.currency = cur; done.push("switched the currency to " + cur.trim()); } }
  return done.length ? { meta:m, done:done } : null;
}

var CATALOGUE = Object.keys(T).map(function(k){ return T[k].name.toLowerCase(); });
var EDIT_HELP = "Offline edits I understand: “make it dark” or “light”, a colour (“make it purple”), “call it …”, “bigger/smaller text”, “rounded/square corners”" +
                ", minutes for the pomodoro, or a currency for the expense tracker and websites.";

/* returns {code, meta, summary} for a new app or an edit, or {summary} alone when nothing fits */
function build(text, current){
  /* words inside a new name ("call it Study Sprint") must not pick a template */
  var named = text.replace(/(?:called|named|titled|title it|name it|call it|rename (?:it )?(?:to)?|change the (?:title|name) to)\s+["“']?[^"”'\n,.!?]{2,40}/ig, " ")
                  .replace(/["“][^"”]{2,40}["”]/g, " ");
  var l = lower(named), match = scoreTemplates(named);
  var wantsNew = /\b(build|create|generate|new|instead|another|design|give me|i want|i need)\b|\bmake (a|an|me)\b/.test(l);
  if(current){
    var edit = applyEdits(current, text);
    if(edit && !(wantsNew && match.score >= 2 && match.template !== current.template)){
      return { code:render(edit.meta), meta:edit.meta, summary:"Done: " + edit.done.join(", ") + "." };
    }
    if(!match.template || match.score < 2 && !wantsNew){
      return { summary:"I couldn't apply that offline. " + EDIT_HELP + " For anything else, pick an AI model at the top." };
    }
  }
  if(!match.template){
    if(/\b(page|site|website|homepage)\b/.test(l)){ match.template = "landing"; }
    else return { summary:"Offline, I can build: " + CATALOGUE.join(", ") + ". Try “a habit tracker” or “a website for my bakery called Rise”. Pick an AI model at the top for anything else." };
  }
  var meta = newMeta(match.template, text);
  var t = T[match.template];
  var extra = match.template === "landing"
    ? " Built as a " + (meta.cfg.kind === "general" ? "general" : meta.cfg.kind) + " website; replace the sample text with your own in the Code tab."
    : "";
  return { code:render(meta), meta:meta,
           summary:"Built a " + t.name.toLowerCase() + " called “" + meta.title + "”." + extra + " Try: “make it light”, “make it green” or “call it …”." };
}

/* ---------------- offline Nexus: plain commands -> tool calls ---------------- */
var AGENT_HELP = [
  "I'm running offline, so I follow direct commands. Try:",
  "• check my pc · what's using memory · close notepad",
  "• tidy my desktop · undo the desktop sort",
  "• make a presentation about solar energy · write a document titled Notes: your text",
  "• open notepad · open youtube.com · list apps",
  "• search the web for best laptops",
  "• git status · show recent commits · show files in Documents",
  "• find kbNearest in site/js · read file README.md · run hello.py",
  "• type hello world · press ctrl+s",
  "• whatsapp Mum: I'm on my way · call Dad on whatsapp",
  "• remember I prefer dark mode · forget 1",
  "Pick an AI model at the top if you want free-form requests."
].join("\n");

function clean(s){ return String(s || "").trim().replace(/^["'“]+|["'”.!?]+$/g, "").trim(); }
function place(p){
  var l = clean(p).toLowerCase();
  var known = { "desktop":"~/Desktop", "my desktop":"~/Desktop", "documents":"~/Documents", "my documents":"~/Documents",
                "downloads":"~/Downloads", "my downloads":"~/Downloads", "pictures":"~/Pictures", "home":"~", "my home folder":"~",
                "this folder":".", "hybrid agent":".", "the hybrid agent folder":".", "this project":".", "here":"." };
  return known[l.replace(/^the /, "")] || known[l] || clean(p) || ".";
}

function presentation(text){
  var topic = clean((/\b(?:about|on|for|covering|introducing)\s+(.+?)(?:\s+with\s+\d+\s+slides?)?(?:[:\n.]|$)/i.exec(text) || [])[1] || "") || "My Topic";
  var listed = [];
  var after = text.split(/[:\n]/).slice(1).join("\n");
  if(after.trim()) listed = after.split(/\n|;|•/).map(function(s){ return clean(s.replace(/^[-*\d.)\s]+/, "")); }).filter(Boolean);
  var count = +((/(\d+)\s*-?\s*slides?/i.exec(text) || [])[1] || 0);
  var slides;
  if(listed.length){
    slides = listed.map(function(t){ return { title:t, bullets:["Add your first point", "Add a second point"] }; });
  }else{
    slides = [
      { title:"What is " + topic + "?", bullets:["A one-line definition", "Why it matters now"] },
      { title:"Key points", bullets:["First key point", "Second key point", "Third key point"] },
      { title:"How it works", bullets:["Step one", "Step two", "Step three"] },
      { title:"Examples", bullets:["A real-world example", "Another example"] },
      { title:"Next steps", bullets:["What to do next", "Where to learn more"] }
    ];
    if(count >= 2) slides = slides.slice(0, Math.min(count - 1, 5));
  }
  return { title:cap(topic), slides:slides };
}

function agent(text, ctx){
  var t = String(text).trim(), l = t.toLowerCase().replace(/\s+/g, " "), m;
  var tools = ctx.tools || {}, apps = ctx.apps || [];
  function plan(steps, after){
    var missing = steps.filter(function(s){ return !tools[s.tool]; });
    if(missing.length) return { reply:"That needs the PC tools, which only run in the local version of Hybrid Agent (python serve.py)." };
    return { steps:steps, after:after || "" };
  }

  if(/^(help|\?|what can you do|commands|how do i use (this|you))\b/.test(l)) return { reply:AGENT_HELP };
  if(/\b(undo|revert|put back|restore)\b.*\b(desktop|sort|tidy|organi[sz])/.test(l)) return plan([{ tool:"undo_organize_desktop", args:{} }]);
  if(/\b(tidy|clean( up)?|organi[sz]e|sort)\b.*\bdesktop\b|\bdesktop\b.*\b(tidy|clean|organi[sz]e|sort)\b/.test(l)) return plan([{ tool:"organize_desktop", args:{} }]);
  if((m = /^(?:read|show|open|cat|print)\s+(?:the\s+)?file\s+(.+)$/i.exec(t)) || (m = /^(?:read|cat)\s+(.+\.\w{1,5})$/i.exec(t))) return plan([{ tool:"read_file", args:{ path:place(m[1]) } }]);
  if((m = /^(?:run|execute)\s+(?:the\s+)?(?:script\s+)?(.+\.(?:py|js|bat|cmd|ps1))$/i.exec(t))) return plan([{ tool:"run_script", args:{ path:clean(m[1]) } }]);
  if((m = /^(?:find|search for|search|grep|look for)\s+["“']?(.+?)["”']?\s+in\s+(?:the\s+)?(?:files?\s+(?:in\s+)?|folder\s+)?(.+)$/i.exec(t)) && !/\b(web|internet|online|google)\b/.test(l))
    return plan([{ tool:"search_files", args:{ path:place(m[2]), text:clean(m[1]) } }]);
  if((m = /^git\s+(add|commit|stash|checkout|switch|restore|pull|fetch|init)\b(.*?)(?:\s+in\s+(.+))?$/i.exec(t)))
    return plan([{ tool:"git_change", args:{ command:(m[1] + m[2]).trim(), path:place(m[3] || ".") } }]);
  if(/\bgit\b|\bcommits?\b|\brepo(sitory)?\b.*\b(status|changes|history)\b|\bbranch(es)?\b/.test(l)){
    var where = (/\bin\s+(?:the\s+)?(.+?)(?:\s+(?:repo|repository|folder))?$/i.exec(t) || [])[1];
    var cmd = /\b(commits?|log|history|recent)\b/.test(l) ? "log --oneline -10" : /\b(diff|changes|changed)\b/.test(l) ? "diff --stat" : /\bbranch/.test(l) ? "branch -a" : "status";
    return plan([{ tool:"git_read", args:{ command:cmd, path:place(where || ".") } }]);
  }
  if(/\b(presentation|slides?|slide deck|deck|powerpoint|pptx)\b/.test(l)){
    var p = presentation(t);
    return plan([{ tool:"create_presentation", args:{ title:p.title, slides:JSON.stringify(p.slides) } }],
      "The slides have placeholder bullets for you to fill in. Pick an AI model at the top if you want the content written for you.");
  }
  if(/\b(word doc(ument)?|document|docx|letter|report|essay)\b/.test(l) && /\b(write|create|make|draft|new|start)\b/.test(l)){
    var title = clean((/\b(?:titled|called|named|about|on)\s+([^:\n]+)/i.exec(t) || [])[1] || "") || "New document";
    var body = t.indexOf(":") >= 0 ? t.slice(t.indexOf(":") + 1).trim() : "";
    return plan([{ tool:"create_word_document", args:{ title:cap(title), content:body || "Start writing here." } }]);
  }
  if((m = /^remember\s+(?:that\s+)?(.+)$/i.exec(t))) return plan([{ tool:"remember", args:{ rule:clean(m[1]) } }]);
  if((m = /^forget\s+(?:item\s+|number\s+|#)?(\d+)/i.exec(t))) return plan([{ tool:"forget", args:{ number:+m[1] } }]);
  if((m = /^(?:send\s+)?(?:a\s+)?(?:whatsapp|message|msg|text)\s+(?:message\s+)?(?:to\s+)?(.+?)\s*(?::|\bsaying\b|\bthat says\b|\bthat\b|\s-\s)\s*(.+)$/i.exec(t)))
    return plan([{ tool:"whatsapp_message", args:{ contact:clean(m[1]).replace(/\s+on whatsapp$/i, ""), message:m[2].trim() } }]);
  if((m = /^(?:whatsapp\s+)?(?:call|ring|phone)\s+(.+?)(?:\s+on\s+whatsapp)?$/i.exec(t))) return plan([{ tool:"whatsapp_call", args:{ contact:clean(m[1]) } }]);
  if((m = /^type\s+(.+?)(\s+and\s+(?:press|hit)\s+enter)?$/i.exec(t))) return plan([{ tool:"type_text", args:{ text:clean(m[1]), press_enter:!!m[2] } }],
    "I waited 4 seconds before typing, so the text went into whichever window you clicked.");
  if((m = /^(?:press|hit)\s+([a-z0-9+ -]+)$/i.exec(t))) return plan([{ tool:"press_keys", args:{ keys:m[1].trim().replace(/\s*(\+|-|\s)\s*/g, "+") } }]);
  if(/\b(screen|screenshot)\b/.test(l) && /\b(look|see|what|read|describe|check|inspect)\b/.test(l)) return plan([{ tool:"look_at_screen", args:{ question:t } }]);
  if(/\b(how('s| is)|check|status|health|vitals|diagnos\w*)\b.*\b(pc|computer|laptop|system|machine)\b|\b(vitals|cpu|battery|disk space|storage left)\b/.test(l))
    return plan([{ tool:"system_vitals", args:{} }, { tool:"memory_hogs", args:{ top_n:5 } }]);
  if(/\b(memory|ram)\b.*\b(hog|hogs|usage|using|use|eating)\b|\bwhat('s| is) (using|eating|hogging)\b|\btop processes\b/.test(l)) return plan([{ tool:"memory_hogs", args:{ top_n:8 } }]);
  if((m = /^(?:close|kill|quit|end|force close|stop)\s+(?:the\s+)?(?:app\s+|process\s+|program\s+)?(.+)$/i.exec(t))) return plan([{ tool:"kill_process", args:{ target:clean(m[1]) } }]);
  if(/^(list|show|what)\b.*\bapps\b/.test(l)) return plan([{ tool:"list_apps", args:{} }]);
  if((m = /^(?:show|list|explore|what'?s in|whats in|browse)\s+(?:me\s+)?(?:the\s+)?(?:files|contents|folder)?\s*(?:in|of)?\s*(.+)$/i.exec(t)) && !/\bapps?\b/.test(l))
    return plan([{ tool:"explore_folder", args:{ path:place(m[1]), depth:2 } }]);
  if((m = /^(?:search|google|look up|find)\s+(?:the\s+)?(?:web|internet|online)?\s*(?:for\s+)?(.+)$/i.exec(t))) return plan([{ tool:"search_web", args:{ query:clean(m[1]) } }]);
  if((m = /^(?:open|launch|start|go to|visit)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i.exec(t))){
    var target = clean(m[1]), tl = target.toLowerCase();
    if(/^https?:\/\//.test(tl) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(tl)) return plan([{ tool:"open_url", args:{ url:target } }]);
    var app = apps.filter(function(a){ return a.key === tl || String(a.label).toLowerCase() === tl; })[0]
           || apps.filter(function(a){ return String(a.label).toLowerCase().indexOf(tl) >= 0 || tl.indexOf(String(a.label).toLowerCase()) >= 0; })[0];
    if(app) return plan([{ tool:"open_app", args:{ app:app.key } }]);
    return { reply:"I don't have “" + target + "” in the app list. Say “list apps” to see what I can open, or give me a web address like youtube.com." };
  }
  return { reply:"I didn't catch a command there.\n\n" + AGENT_HELP };
}

window.HybridOffline = { build:build, agent:agent, help:AGENT_HELP, templates:CATALOGUE };
})();
