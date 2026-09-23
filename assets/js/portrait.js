(function () {
  "use strict";

  // Home hero photo window: the red dot is a real close button that never quite works.
  // Each press plays the next gag in a short rotation (about 2-3 s each). The photo always
  // comes back, clicks during a gag only make the window shake, and reduced motion swaps
  // every animation for a static system dialog.

  const doc = document;
  const win = doc.querySelector(".portrait-window");
  const closeButton = win && win.querySelector("[data-portrait-close]");
  const frame = win && win.querySelector(".portrait-frame");
  const photo = frame && frame.querySelector("img");
  if (!closeButton || !frame || !photo) return;

  const title = win.querySelector("[data-portrait-title]");
  const place = win.querySelector("[data-portrait-place]");
  const fileName = title ? title.textContent.trim() : "ABOUT_ME.PNG";
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  const homePlace = place ? place.textContent : "";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  let attempts = 0;
  let played = 0;
  let restores = 0;
  let busy = false;
  let timers = [];
  let announceTimer = 0;

  // Everything the gags draw lives in one overlay inside the photo frame.
  const stage = doc.createElement("div");
  stage.className = "portrait-stage";
  stage.setAttribute("aria-hidden", "true");
  frame.appendChild(stage);

  const live = doc.createElement("p");
  live.className = "portrait-live";
  live.setAttribute("role", "status");
  frame.appendChild(live);

  function reduced() {
    return Boolean((window.JBOS && window.JBOS.reduceMotion) || motionQuery.matches);
  }

  function play(name) {
    const sound = window.JBOS && window.JBOS.sound;
    if (sound && typeof sound.play === "function") sound.play(name);
  }

  function later(fn, ms) {
    timers.push(window.setTimeout(fn, ms));
  }

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function announce(text) {
    window.clearTimeout(announceTimer);
    live.textContent = "";
    announceTimer = window.setTimeout(function () { live.textContent = text; }, 80);
  }

  function currentName() {
    return title ? title.textContent.trim() : fileName;
  }

  // Keep "ABOUT_ME (1).PNG" on one line inside the narrow dialogs.
  function unbroken(text) {
    return text.replace(/ /g, "\u00A0");
  }

  function setPlace(text) {
    if (place) place.textContent = text;
  }

  function shake() {
    if (reduced()) return;
    win.classList.remove("is-refusing");
    void win.offsetWidth;
    win.classList.add("is-refusing");
  }

  win.addEventListener("animationend", function (event) {
    if (event.target === win && event.animationName === "portraitShake") {
      win.classList.remove("is-refusing");
    }
  });

  // A tiny system dialog: { bar, icon, heading, text, buttons }.
  function dialog(spec) {
    const box = el("div", "portrait-alert");
    const bar = el("div", "portrait-alert__bar");
    bar.appendChild(el("i"));
    bar.appendChild(el("span", "", spec.bar || "SYSTEM"));
    box.appendChild(bar);

    const body = el("div", "portrait-alert__body");
    body.appendChild(el("b", "portrait-alert__icon", spec.icon || "!"));
    const copy = el("p");
    copy.appendChild(el("strong", "", spec.heading));
    if (spec.text) copy.appendChild(el("span", "", spec.text));
    body.appendChild(copy);
    box.appendChild(body);

    if (spec.buttons) {
      const actions = el("div", "portrait-alert__actions");
      spec.buttons.forEach(function (label) { actions.appendChild(el("span", "", label)); });
      box.appendChild(actions);
    }

    stage.textContent = "";
    stage.appendChild(box);
    return box;
  }

  function finish() {
    timers.forEach(window.clearTimeout);
    timers = [];
    win.removeAttribute("data-gag");
    stage.classList.remove("is-leaving", "is-lit");
    stage.textContent = "";
    setPlace(homePlace);
    busy = false;
  }

  // Fade the overlay out, then clear everything.
  function wrapUp(at) {
    later(function () { stage.classList.add("is-leaving"); }, at);
    later(finish, at + 200);
  }

  function rename() {
    restores += 1;
    if (!title) return;
    title.textContent = stem + " (" + restores + ")" + extension;
    title.classList.remove("is-renamed");
    void title.offsetWidth;
    title.classList.add("is-renamed");
  }

  // 1. The classic refusal, with a running tally on later rounds.
  function refuse(round) {
    const line = round === 0
      ? "This window is load-bearing."
      : round === 1
        ? "Still load-bearing."
        : "Attempts: " + attempts + ". Windows closed: 0.";
    const heading = "Can't close " + currentName() + ".";
    shake();
    play("error");
    dialog({ bar: "SYSTEM", icon: "!", heading: "Can't close " + unbroken(currentName()) + ".", text: line });
    announce(heading + " " + line);
    wrapUp(2600);
  }

  // 2. It actually closes: the picture collapses like an old TV, then restores itself from backup.
  function powerCycle() {
    if (reduced()) {
      const next = stem + " (" + (restores + 1) + ")" + extension;
      rename();
      dialog({ bar: "SYSTEM", icon: "\u21BB", heading: "Window closed.", text: "Restored from backup as " + unbroken(next) + "." });
      announce("Window closed. Restored from backup as " + next + ".");
      wrapUp(3200);
      return;
    }

    play("powerdown");
    win.setAttribute("data-gag", "crt");
    const screen = el("div", "portrait-crt");
    screen.appendChild(el("p", "", "WINDOW CLOSED."));
    screen.appendChild(el("p", "", "RESTORING FROM BACKUP"));
    const meter = el("div", "portrait-crt__meter");
    meter.appendChild(el("i"));
    screen.appendChild(meter);
    stage.textContent = "";
    stage.appendChild(screen);
    announce("Window closed. Restoring from backup.");

    later(function () { stage.classList.add("is-lit"); }, 480);
    later(function () {
      stage.classList.remove("is-lit");
      win.setAttribute("data-gag", "crt-on");
      play("powerup");
    }, 1900);
    later(function () {
      rename();
      announce("Restored as " + currentName() + ".");
    }, 2250);
    later(finish, 2400);
  }

  // 3. The photo drops out of frame, peeks back in, and pops home.
  function peek() {
    if (reduced()) {
      dialog({ bar: "SYSTEM", icon: "?", heading: unbroken(currentName()) + " stepped out.", text: "It came back." });
      announce(currentName() + " stepped out. It came back.");
      wrapUp(3200);
      return;
    }

    play("whoosh");
    win.setAttribute("data-gag", "peek");
    setPlace("BRB");
    announce("The photo slipped out of frame. It is peeking back in.");
    later(function () { play("pop"); setPlace(homePlace); }, 2480);
    later(finish, 2850);
  }

  // 4. A permission prompt with exactly one possible answer.
  function permission() {
    const heading = "\u201C" + currentName() + "\u201D would like to stay open.";
    play("chime");
    const box = dialog({
      bar: "PERMISSIONS",
      icon: "?",
      heading: "\u201C" + unbroken(currentName()) + "\u201D would like to stay open.",
      buttons: ["Allow", "Allow"]
    });
    announce(heading + " Options: Allow, or Allow.");
    later(function () {
      const pick = box.querySelector(".portrait-alert__actions span:last-child");
      if (pick) pick.classList.add("is-pressed");
      play("click");
      announce("Allowed.");
    }, 1650);
    wrapUp(2250);
  }

  const gags = [refuse, powerCycle, peek, permission];

  closeButton.addEventListener("click", function () {
    attempts += 1;
    if (busy) {
      shake();
      play("error");
      return;
    }
    busy = true;
    const gag = gags[played % gags.length];
    const round = Math.floor(played / gags.length);
    played += 1;
    gag(round);
    // Safety net: whatever happens to the timers, the photo is always back within a few seconds.
    later(finish, 4500);
  });

  // The title bar is the drag handle (site.js); pressing or double-clicking the dot must not
  // start a drag or snap the window back.
  closeButton.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
  closeButton.addEventListener("dblclick", function (event) { event.stopPropagation(); });

  // A hidden tab can throttle the timers; never leave the photo mid-gag.
  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden && busy) finish();
  });
})();
