/* HYBRID AGENT — landing page interactions. */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var body = document.body;

  /* Sticky header state */
  var header = document.querySelector(".site-header");
  function updateHeader() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 12);
  }
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  /* Mobile navigation */
  var menuButton = document.querySelector(".menu-toggle");
  var menu = document.getElementById("nav-menu");
  function setMenu(open) {
    if (!menuButton || !menu) return;
    menuButton.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("open", open);
    body.classList.toggle("menu-open", open);
  }
  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      setMenu(menuButton.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setMenu(false);
    });
    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
    });
  }

  /* Section reveals */
  var revealItems = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach(function (item) { item.classList.add("in"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -7%" });
    revealItems.forEach(function (item) { revealObserver.observe(item); });
  }

  /* Hero route and frame activity */
  var routeLabel = document.getElementById("hero-model");
  var routePills = document.querySelectorAll(".route-pills span");
  var frameLabel = document.getElementById("hero-frame");
  var routes = [
    { name: "OLLAMA / QWEN2.5", event: "OLLAMA" },
    { name: "GOOGLE / GEMINI", event: "GEMINI" },
    { name: "ANTHROPIC / CLAUDE", event: "CLAUDE" }
  ];
  var routeIndex = 0;
  var frame = 842;

  function cycleRoute() {
    routeIndex = (routeIndex + 1) % routes.length;
    if (routeLabel) routeLabel.textContent = routes[routeIndex].name;
    routePills.forEach(function (pill, index) {
      pill.classList.toggle("active", index === routeIndex);
    });
  }

  if (!reducedMotion) {
    window.setInterval(cycleRoute, 3200);
    window.setInterval(function () {
      frame += 1;
      if (frame > 999999) frame = 0;
      if (frameLabel) frameLabel.textContent = String(frame).padStart(6, "0");
    }, 900);
  }

  /* Interactive gesture demonstration */
  var demo = document.getElementById("gesture-demo");
  var gestureButtons = document.querySelectorAll(".gesture-button");
  var gestureOutput = document.getElementById("gesture-output");
  var demoDirective = document.getElementById("demo-directive");
  var demoState = document.getElementById("demo-state");
  var demoToast = document.getElementById("demo-toast");
  var demoCursor = demo ? demo.querySelector(".demo-cursor") : null;
  var toastTimer = 0;
  var autoTimer = 0;
  var activeGesture = 0;

  var gestures = [
    {
      name: "OPEN_PALM",
      target: "target-a",
      x: 70,
      y: 29,
      directive: "Move toward Open App",
      output: "pointer.move(70, 29)",
      state: "POINTER ACTIVE",
      toast: "TARGET ACQUIRED"
    },
    {
      name: "CLOSED_FIST",
      target: "target-b",
      x: 28,
      y: 73,
      directive: "Click Ask Model",
      output: "pointer.click(28, 73)",
      state: "CLICK DISPATCHED",
      toast: "ACTION SENT"
    },
    {
      name: "PINCH",
      target: "target-c",
      x: 78,
      y: 72,
      directive: "Drag toward Connect Device",
      output: "pointer.down(78, 72)",
      state: "DRAG ACTIVE",
      toast: "BUTTON HELD"
    }
  ];

  function showToast(message) {
    if (!demoToast) return;
    window.clearTimeout(toastTimer);
    demoToast.textContent = message;
    demoToast.classList.add("show");
    toastTimer = window.setTimeout(function () {
      demoToast.classList.remove("show");
    }, 1250);
  }

  function runGesture(index, userInitiated) {
    var item = gestures[index];
    if (!item || !demo) return;
    activeGesture = index;

    gestureButtons.forEach(function (button, buttonIndex) {
      var selected = buttonIndex === index;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    demo.querySelectorAll(".demo-target").forEach(function (target) {
      target.classList.toggle("active", target.id === item.target);
    });

    demo.style.setProperty("--cursor-x", item.x + "%");
    demo.style.setProperty("--cursor-y", item.y + "%");

    if (demoCursor) {
      demoCursor.classList.remove("clicked");
      void demoCursor.offsetWidth;
      demoCursor.classList.add("clicked");
    }
    if (gestureOutput) gestureOutput.textContent = item.output;
    if (demoDirective) demoDirective.textContent = item.directive;
    if (demoState) demoState.textContent = item.state;
    showToast(item.toast);

    if (userInitiated) {
      window.clearInterval(autoTimer);
      if (!reducedMotion) autoTimer = window.setInterval(function () {
        runGesture((activeGesture + 1) % gestures.length, false);
      }, 4200);
    }
  }

  gestureButtons.forEach(function (button, index) {
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", function () { runGesture(index, true); });
  });

  if (demo && !reducedMotion) {
    autoTimer = window.setInterval(function () {
      runGesture((activeGesture + 1) % gestures.length, false);
    }, 4200);
  }

  /* Copy local setup commands */
  var copyButton = document.getElementById("copy-command");
  var setupText = [
    'cd "C:\\Users\\User\\Desktop\\HYBRID AGENT"',
    "python -m pip install -r requirements.txt",
    "python configure.py",
    "python serve.py"
  ].join("\n");

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", function () {
      copyText(setupText).then(function () {
        copyButton.querySelector("span").textContent = "Copied";
        copyButton.querySelector("b").textContent = "READY";
        window.setTimeout(function () {
          copyButton.querySelector("span").textContent = "Copy commands";
          copyButton.querySelector("b").textContent = "CTRL+C";
        }, 1800);
      }).catch(function () {
        copyButton.querySelector("span").textContent = "Select commands above";
      });
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();

/* Builder prompt: Enter submits, example chips fill the box and go */
(function () {
  var form = document.getElementById("hero-build");
  if (!form) return;
  var box = document.getElementById("hero-prompt");
  box.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (box.value.trim()) form.requestSubmit();
    }
  });
  document.querySelectorAll(".build-chips button").forEach(function (chip) {
    chip.addEventListener("click", function () {
      box.value = chip.dataset.prompt;
      form.requestSubmit();
    });
  });
})();
