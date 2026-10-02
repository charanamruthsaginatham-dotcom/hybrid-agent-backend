/* HYBRID AGENT - builder + Nexus agent.
   Build mode: prompt -> model writes one HTML file -> live sandboxed preview.
   Agent mode: Nexus picks tools; read-only ones run, PC-changing ones wait for Approve. */
(function(){
"use strict";
var $ = function(s){ return document.querySelector(s); };

var BASE = "";
try{ BASE = (localStorage.getItem("backend_url") || "").replace(/\/+$/, ""); }catch(e){}
function api(path){ return BASE + path; }

var STORE = "hybrid-builder-project";
var MAX_TOOL_STEPS = 8;
function blank(){ return { name:"New project", versions:[], meta:[], current:-1, chat:[] }; }
var P = blank();
var busy = false, channels = [], mode = "build", agentLocal = true, nextId = 1;
var OFFLINE = "offline", toolInfo = {}, appList = [], queue = [], queueNote = "";
function offline(){ return $("#model").value === OFFLINE; }

var feed = $("#feed"), promptBox = $("#prompt"), frame = $("#frame"), code = $("#code");

/* ---------------- persistence (a convenience; the page works without it) ---------------- */
function save(){
  try{ localStorage.setItem(STORE, JSON.stringify(P)); }catch(e){}
}
function load(){
  try{
    var raw = localStorage.getItem(STORE);
    if(raw){ var p = JSON.parse(raw); if(p && Array.isArray(p.versions)) P = p; }
  }catch(e){}
  if(!Array.isArray(P.meta)) P.meta = [];
  P.chat.forEach(function(e){
    if(!e.id) e.id = nextId++;
    nextId = Math.max(nextId, e.id + 1);
    if(e.role === "tool" && e.status === "running") e.status = "pending";
  });
}
function push(entry){
  entry.id = nextId++;
  P.chat.push(entry);
  save();
  return addMsg(entry);
}

/* ---------------- chat feed ---------------- */
function fileLinks(el, text){
  var re = /\[file:([^\]\/\\]+)\]/g, m;
  while((m = re.exec(text))){
    var a = document.createElement("a");
    a.className = "dl"; a.href = api("/api/agent/file?name=" + encodeURIComponent(m[1]));
    a.textContent = "Download " + m[1];
    el.appendChild(a);
    el.appendChild(document.createElement("br"));
  }
}

function toolCard(entry){
  var el = document.createElement("div");
  el.className = "msg toolcard " + entry.status + (entry.risk === "ask" && entry.status === "pending" ? " ask" : "");
  var head = document.createElement("header");
  var name = document.createElement("span"); name.className = "tname"; name.textContent = entry.tool;
  var state = document.createElement("span"); state.className = "tstate";
  state.textContent = { pending: entry.risk === "ask" ? "needs your OK" : "queued", running:"running…",
                        done:"done", error:"failed", denied:"denied" }[entry.status] || entry.status;
  head.appendChild(name); head.appendChild(state);
  el.appendChild(head);
  if(entry.summary){
    var sum = document.createElement("p"); sum.className = "tsum"; sum.textContent = entry.summary;
    el.appendChild(sum);
  }
  var args = JSON.stringify(entry.args || {}, null, 2);
  if(args !== "{}"){
    if(entry.status === "pending"){
      var pre = document.createElement("pre"); pre.textContent = args; el.appendChild(pre);
    }else{
      var d = document.createElement("details"), s = document.createElement("summary");
      s.textContent = "Arguments"; d.appendChild(s);
      var pa = document.createElement("pre"); pa.textContent = args; d.appendChild(pa);
      el.appendChild(d);
    }
  }
  if(entry.status === "pending" && entry.risk === "ask"){
    var row = document.createElement("div"); row.className = "tactions";
    var ok = document.createElement("button"); ok.type = "button"; ok.className = "approve"; ok.textContent = "Approve";
    var no = document.createElement("button"); no.type = "button"; no.className = "deny"; no.textContent = "Deny";
    ok.addEventListener("click", function(){ approve(entry, true); });
    no.addEventListener("click", function(){ approve(entry, false); });
    row.appendChild(ok); row.appendChild(no);
    el.appendChild(row);
  }
  if(entry.result){
    var r = document.createElement("pre"); r.textContent = entry.result.replace(/\n?\[file:[^\]]+\]/g, "");
    el.appendChild(r);
    fileLinks(el, entry.result);
  }
  return el;
}

function render(entry){
  if(entry.role === "tool") return toolCard(entry);
  var el = document.createElement("div");
  el.className = "msg " + entry.role + (entry.mode === "agent" ? " agent" : "") + (entry.error ? " err" : "");
  if(entry.role === "ai"){
    var who = document.createElement("span");
    who.className = "who"; who.textContent = entry.mode === "agent" ? "Nexus · " + (entry.model || "") : (entry.model || "model");
    el.appendChild(who);
  }
  el.appendChild(document.createTextNode(entry.text));
  if(typeof entry.version === "number"){
    var b = document.createElement("button");
    b.type = "button"; b.className = "restore"; b.dataset.version = entry.version;
    b.addEventListener("click", function(){ showVersion(entry.version); });
    el.appendChild(document.createElement("br"));
    el.appendChild(b);
  }
  return el;
}

function addMsg(entry){
  $("#empty").hidden = true;
  var el = render(entry);
  el.dataset.id = entry.id;
  feed.insertBefore(el, $("#thinking"));
  feed.scrollTop = feed.scrollHeight;
  markVersions();
  return el;
}
function refresh(entry){
  var old = feed.querySelector('[data-id="' + entry.id + '"]');
  if(!old) return;
  var el = render(entry); el.dataset.id = entry.id;
  old.replaceWith(el);
  feed.scrollTop = feed.scrollHeight;
}
function markVersions(){
  feed.querySelectorAll(".restore").forEach(function(b){
    var v = Number(b.dataset.version), on = v === P.current;
    b.textContent = on ? "Version " + (v + 1) + " · showing" : "Restore version " + (v + 1);
    b.setAttribute("aria-current", on ? "true" : "false");
  });
}
function renderFeed(){
  Array.prototype.slice.call(feed.querySelectorAll(".msg")).forEach(function(m){ m.remove(); });
  $("#empty").hidden = P.chat.length > 0;
  P.chat.forEach(addMsg);
}
function thinking(on){
  var t = $("#thinking");
  if(on && !t){
    t = document.createElement("div"); t.id = "thinking"; t.className = "thinking";
    t.setAttribute("aria-label", "Nexus is thinking");
    t.innerHTML = "<i></i><i></i><i></i>";
    feed.appendChild(t);
    feed.scrollTop = feed.scrollHeight;
  }else if(!on && t){ t.remove(); }
}

/* ---------------- mode ---------------- */
function setMode(m){
  mode = m === "agent" ? "agent" : "build";
  document.body.classList.toggle("agent", mode === "agent");
  document.querySelectorAll(".mode").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  document.querySelectorAll("#empty [data-for]").forEach(function(d){ d.hidden = d.dataset.for !== mode; });
  try{ localStorage.setItem("hybrid-builder-mode", mode); }catch(e){}
  labels();
}
function labels(){
  var built = P.current >= 0;
  $("#send").textContent = mode === "agent" ? "Ask Nexus →" : (built ? "Update →" : "Build →");
  promptBox.placeholder = mode === "agent" ? "Ask Nexus to do something on this PC…"
    : (built ? "Describe a change…" : "Describe your app…");
}
document.querySelectorAll(".mode").forEach(function(b){
  b.addEventListener("click", function(){ setMode(b.dataset.mode); promptBox.focus(); });
});

/* ---------------- preview + code ---------------- */
function run(src){
  $("#placeholder").hidden = !!src;
  frame.srcdoc = src || "";
}
function showVersion(i){
  if(i < 0 || i >= P.versions.length) return;
  P.current = i;
  code.value = P.versions[i];
  run(P.versions[i]);
  $("#download").disabled = false;
  $("#run").hidden = true;
  markVersions(); labels(); save();
}

function setTab(which){
  var preview = which === "preview";
  $("#tab-preview").classList.toggle("active", preview);
  $("#tab-code").classList.toggle("active", !preview);
  $("#tab-preview").setAttribute("aria-selected", String(preview));
  $("#tab-code").setAttribute("aria-selected", String(!preview));
  $("#pane-preview").hidden = !preview;
  $("#pane-code").hidden = preview;
}
$("#tab-preview").addEventListener("click", function(){ setTab("preview"); });
$("#tab-code").addEventListener("click", function(){ setTab("code"); });

code.addEventListener("input", function(){ $("#run").hidden = false; });
code.addEventListener("keydown", function(e){
  if(e.key === "Tab"){
    e.preventDefault();
    code.setRangeText("  ", code.selectionStart, code.selectionEnd, "end");
    $("#run").hidden = false;
  }
});
$("#run").addEventListener("click", function(){
  addVersion(code.value, null);
  push({ role:"ai", model:"you", text:"Manual edit applied.", version:P.current });
  showVersion(P.current);
  setTab("preview");
});
$("#reload").addEventListener("click", function(){ if(P.current >= 0) run(P.versions[P.current]); });
$("#expand").addEventListener("click", function(){
  var on = document.body.classList.toggle("expanded");
  $("#expand").setAttribute("aria-pressed", String(on));
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape" && document.body.classList.contains("expanded")) $("#expand").click();
});

$("#download").addEventListener("click", function(){
  if(P.current < 0) return;
  var blob = new Blob([P.versions[P.current]], { type:"text/html" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (P.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app") + ".html";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
});

function reset(){
  P = blank();
  save(); renderFeed(); code.value = ""; run("");
  $("#project-name").textContent = P.name;
  $("#download").disabled = true;
  labels();
}
$("#new-project").addEventListener("click", function(){
  if(busy) return;
  if(P.chat.length && !confirm("Start over? The current app and conversation will be cleared.")) return;
  reset();
  promptBox.focus();
});

/* ---------------- models ---------------- */
/* "Offline" is always first and needs nothing; AI channels are added when the backend has them */
function loadModels(){
  var sel = $("#model");
  function fill(){
    sel.innerHTML = "";
    var o = document.createElement("option");
    o.value = OFFLINE; o.textContent = "Offline · no AI needed";
    sel.appendChild(o);
    channels.forEach(function(c){
      var opt = document.createElement("option");
      opt.value = c.channel; opt.textContent = c.label + " · " + c.model;
      sel.appendChild(opt);
    });
    var pick = "";
    try{ pick = localStorage.getItem("hybrid-builder-model") || ""; }catch(e){}
    sel.value = pick && sel.querySelector('option[value="' + pick.replace(/"/g, "") + '"]') ? pick : OFFLINE;
    sel.disabled = false;
  }
  return fetch(api("/api/models"), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){ channels = (d.channels || []).filter(function(c){ return c.has_key; }); })
    .catch(function(){ channels = []; })
    .then(fill);
}
function loadTools(){
  var tools = fetch(api("/api/agent/tools"), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){
      agentLocal = !!d.local;
      toolInfo = {};
      (d.tools || []).forEach(function(t){ toolInfo[t.name] = t; });
      if(!agentLocal) $("#agent-note").textContent =
        "This is the online copy, so Nexus can't touch a PC from here. Run Hybrid Agent locally (python serve.py) for files, apps, documents and system tools.";
    })
    .catch(function(){
      agentLocal = false;
      $("#agent-note").textContent = "The Hybrid Agent backend isn't running, so PC tools are off. Start it with  python serve.py  to use them. Building apps still works.";
    });
  var apps = fetch(api("/api/apps"), { cache:"no-store" })
    .then(function(r){ return r.json(); })
    .then(function(d){ appList = d.apps || []; })
    .catch(function(){ appList = []; });
  return Promise.all([tools, apps]);
}
$("#model").addEventListener("change", function(){
  try{ localStorage.setItem("hybrid-builder-model", $("#model").value); }catch(e){}
});

function post(path, body){
  return fetch(api(path), {
    method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
  })
  .then(function(r){ return r.json().then(function(d){ return { status:r.status, d:d }; }); })
  .then(function(res){
    if(!res.d.ok && !("result" in res.d)) throw new Error(res.d.error || ("HTTP " + res.status));
    return res.d;
  });
}
function friendly(err){
  var msg = err && err.message ? err.message : String(err);
  if(/Failed to fetch|NetworkError/i.test(msg)) msg = "Could not reach the Hybrid Agent backend. Start it with  python serve.py  and reload.";
  return msg;
}
function noModel(text){
  push({ role:"you", mode:mode, text:text });
  push({ role:"ai", mode:mode, model:"hybrid agent", error:true,
    text:"No model is available. Start Ollama on this machine, or sign in on the console and add a Gemini or Claude key in its KEYS panel, then reload this page." });
}

/* ---------------- build mode ---------------- */
function extract(text){
  var m = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  if(m) return { code:m[1].trim(), summary:text.slice(0, m.index).trim(), cut:false };
  var open = /```(?:html)?\s*\n/i.exec(text);
  if(open) return { code:text.slice(open.index + open[0].length).trim(), summary:text.slice(0, open.index).trim(), cut:true };
  var doc = text.search(/<!doctype html|<html[\s>]/i);
  if(doc >= 0) return { code:text.slice(doc).trim(), summary:text.slice(0, doc).trim(), cut:false };
  return null;
}
function buildPrompt(request){
  if(P.current < 0) return "Build this app:\n\n" + request;
  return "Here is the current app:\n\n```html\n" + P.versions[P.current] + "\n```\n\nChange request: " + request;
}

var timer = null;
function working(on, label){
  busy = on;
  $("#send").disabled = on;
  $("#working").hidden = !on;
  clearInterval(timer);
  if(on){
    var t0 = Date.now(), steps = [label, "Laying out the interface…", "Wiring up the logic…", "Polishing the details…"];
    $("#working-text").textContent = steps[0];
    $("#working-time").textContent = "0s";
    timer = setInterval(function(){
      var s = Math.round((Date.now() - t0) / 1000);
      $("#working-time").textContent = s + "s";
      $("#working-text").textContent = steps[Math.min(steps.length - 1, Math.floor(s / 12))];
    }, 1000);
  }
}

function addVersion(code, meta){
  P.versions.push(code);
  P.meta[P.versions.length - 1] = meta || null;
  P.current = P.versions.length - 1;
}

function buildOffline(text){
  var first = P.current < 0;
  var r = window.HybridOffline.build(text, P.current >= 0 ? P.meta[P.current] : null);
  push({ role:"you", mode:"build", text:text });
  setTab("preview");
  working(true, first ? "Assembling your app…" : "Applying your change…");
  setTimeout(function(){
    working(false);
    if(r.code){
      addVersion(r.code, r.meta);
      if(first){ P.name = r.meta.title; $("#project-name").textContent = P.name; }
      push({ role:"ai", mode:"build", model:"offline engine", text:r.summary, version:P.current });
      showVersion(P.current);
    }else{
      push({ role:"ai", mode:"build", model:"offline engine", text:r.summary });
    }
    save(); promptBox.focus();
  }, 500);
}

function build(text){
  if(offline()) return buildOffline(text);
  var channel = $("#model").value;
  var first = P.current < 0;
  if(first){
    P.name = text.replace(/\s+/g, " ").slice(0, 48) + (text.length > 48 ? "…" : "");
    $("#project-name").textContent = P.name;
  }
  push({ role:"you", mode:"build", text:text });
  setTab("preview");
  working(true, first ? "Writing your app…" : "Applying your change…");

  post("/api/chat", { prompt:buildPrompt(text), channel:channel, mode:"build" })
  .then(function(d){
    var got = extract(d.text || "");
    if(!got || !got.code) throw new Error("The model replied without any code. Try rephrasing, or pick a larger model.");
    addVersion(got.code, null);
    var note = got.summary || (first ? "Here is your app." : "Done.");
    if(got.cut) note += "\n\nThe reply hit the length limit, so the end of the file may be missing. Ask for a smaller change or a simpler app if it looks broken.";
    push({ role:"ai", mode:"build", model:d.model || channel, text:note, version:P.current });
    showVersion(P.current);
  })
  .catch(function(err){
    push({ role:"ai", mode:"build", model:"hybrid agent", text:friendly(err), error:true });
    promptBox.value = promptBox.value || text;
  })
  .then(function(){ working(false); save(); promptBox.focus(); });
}

/* ---------------- agent mode ---------------- */
/* the model sees its own tool requests as raw JSON, then the result, like any tool loop */
function agentMessages(){
  var out = [];
  P.chat.forEach(function(e){
    if(e.mode !== "agent" || e.error) return;
    if(e.role === "you") out.push({ role:"user", content:e.text });
    else if(e.role === "ai") out.push({ role:"assistant", content:e.text });
    else if(e.role === "tool"){
      out.push({ role:"assistant", content:JSON.stringify({ tool:e.tool, args:e.args }) });
      if(e.status === "done" || e.status === "error" || e.status === "denied")
        out.push({ role:"tool", tool:e.tool, content:e.status === "denied" ? "The user denied this action." : e.result });
    }
  });
  return out;
}
function toolStepsSinceUser(){
  var n = 0;
  for(var i = P.chat.length - 1; i >= 0; i--){
    var e = P.chat[i];
    if(e.mode !== "agent") continue;
    if(e.role === "you") break;
    if(e.role === "tool") n++;
  }
  return n;
}

function agentBusy(on){
  busy = on;
  $("#send").disabled = on;
  thinking(on);
}

function agentStep(){
  if(toolStepsSinceUser() >= MAX_TOOL_STEPS){
    push({ role:"ai", mode:"agent", model:"hybrid agent", text:"I stopped after " + MAX_TOOL_STEPS + " tool steps. Tell me how to continue." });
    return;
  }
  agentBusy(true);
  post("/api/agent", { messages:agentMessages(), channel:$("#model").value })
  .then(function(d){
    agentBusy(false);
    if(d.type === "tool"){
      var entry = { role:"tool", mode:"agent", tool:d.tool, args:d.args || {}, risk:d.risk,
                    summary:d.summary, status:"pending", result:"" };
      push(entry);
      if(entry.risk !== "ask") execute(entry);
    }else{
      push({ role:"ai", mode:"agent", model:d.model, text:d.text });
      promptBox.focus();
    }
  })
  .catch(function(err){
    agentBusy(false);
    push({ role:"ai", mode:"agent", model:"hybrid agent", text:friendly(err), error:true });
  });
}

function execute(entry){
  entry.status = "running"; refresh(entry);
  agentBusy(true);
  post("/api/agent/tool", { tool:entry.tool, args:entry.args })
  .then(function(d){
    entry.status = d.ok ? "done" : "error";
    entry.result = d.result || d.error || "";
  })
  .catch(function(err){
    entry.status = "error"; entry.result = friendly(err);
  })
  .then(function(){
    agentBusy(false);
    save(); refresh(entry);
    if(entry.offline) runQueue(); else agentStep();
  });
}

function approve(entry, yes){
  if(busy || entry.status !== "pending") return;
  if(yes){ execute(entry); return; }
  entry.status = "denied"; save(); refresh(entry);
  if(entry.offline){ queue = []; queueNote = ""; promptBox.focus(); }
  else agentStep();
}

/* offline: the command parser hands over a fixed list of tool steps */
function runQueue(){
  var step = queue.shift();
  if(!step){
    if(queueNote){ push({ role:"ai", mode:"agent", model:"offline", text:queueNote }); queueNote = ""; }
    promptBox.focus();
    return;
  }
  var info = toolInfo[step.tool] || {};
  var entry = { role:"tool", mode:"agent", tool:step.tool, args:step.args, risk:info.risk || "ask",
                summary:info.summary || "", status:"pending", result:"", offline:true };
  push(entry);
  if(entry.risk !== "ask") execute(entry);
}

function ask(text){
  push({ role:"you", mode:"agent", text:text });
  P.chat.forEach(function(e){
    if(e.role === "tool" && e.status === "pending"){ e.status = "denied"; refresh(e); }
  });
  if(!offline()){ agentStep(); return; }
  var plan = window.HybridOffline.agent(text, { tools:toolInfo, apps:appList });
  if(plan.reply){ push({ role:"ai", mode:"agent", model:"offline", text:plan.reply }); promptBox.focus(); return; }
  queue = plan.steps.slice(); queueNote = plan.after || "";
  runQueue();
}

/* ---------------- send ---------------- */
function send(text){
  text = (text || "").trim();
  if(!text || busy) return;
  promptBox.value = "";
  if(!offline() && !channels.length){ noModel(text); return; }
  if(mode === "agent") ask(text); else build(text);
}

$("#composer").addEventListener("submit", function(e){ e.preventDefault(); send(promptBox.value); });
promptBox.addEventListener("keydown", function(e){
  if(e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send(promptBox.value); }
});
document.querySelectorAll(".chips button").forEach(function(b){
  b.addEventListener("click", function(){ send(b.dataset.prompt); });
});

/* ---------------- boot ---------------- */
load();
var params = new URLSearchParams(location.search);
var startMode = params.get("mode");
if(!startMode){ try{ startMode = localStorage.getItem("hybrid-builder-mode"); }catch(e){} }
setMode(startMode || "build");
$("#project-name").textContent = P.name;
renderFeed();
if(P.current >= 0) showVersion(P.current);

var incoming = params.get("prompt");
Promise.all([loadModels(), loadTools()]).then(function(){
  if(incoming){
    history.replaceState(null, "", location.pathname);
    if(mode === "build" && P.versions.length) reset();
    send(incoming);
  }else{
    promptBox.focus();
  }
});
})();
