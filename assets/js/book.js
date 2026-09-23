(function () {
  "use strict";

  // The Cure: a page-turning preview reader. Pages are pre-rendered from the PDF;
  // every leaf is a two-sided card that rotates around the spine.
  const doc = document;
  const body = doc.body;
  const reader = doc.getElementById("cure-reader");
  if (!reader || typeof reader.showModal !== "function") return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const singlePage = window.matchMedia("(max-width: 760px)");
  const book = reader.querySelector("[data-book]");
  const flight = reader.querySelector(".cure-flight");
  const stage = reader.querySelector(".cure-stage");
  const label = reader.querySelector("[data-book-label]");
  const live = reader.querySelector("[data-book-live]");
  const scrubber = reader.querySelector("[data-book-scrub]");
  const progress = reader.querySelector(".cure-reader__progress");
  const chapterSelect = reader.querySelector("[data-book-chapter]");
  const soundToggle = reader.querySelector("[data-book-sound]");
  const closeButton = reader.querySelector("[data-book-close]");
  const prevButton = reader.querySelector("[data-book-prev]");
  const nextButton = reader.querySelector("[data-book-next]");
  const footerRestart = reader.querySelector(".cure-reader__foot [data-book-restart]");
  const endTemplate = reader.querySelector("#cure-end-page");
  const pageCover = doc.querySelector(".album-art--book");

  const PAGE_COUNT = Number(reader.dataset.pages) || 0;
  const LEAF_COUNT = Math.floor(PAGE_COUNT / 2) + 1;
  const START_PAGE = 5; // Prologue
  const TURN_MS = reduceMotion ? 0 : 900;
  const RIFFLE_MS = reduceMotion ? 0 : 560;
  const STAGGER_MS = reduceMotion ? 0 : 75;
  const FLIGHT_MS = reduceMotion ? 0 : 760;
  const SHIFT_MS = reduceMotion ? 0 : 720; // .cure-book slide between closed and open
  const chapters = Array.from(chapterSelect ? chapterSelect.options : []).map(function (option) {
    return { page: Number(option.value), name: option.textContent.trim() };
  });

  let spread = 0;
  let side = "right";
  let activeTurns = 0;
  let opening = false;
  let flyingIn = false;
  let closing = false;
  let pendingClose = false;
  let session = 0;
  let lastTrigger = null;
  let suppressClickUntil = 0;
  let liveTimer = 0;

  reader.style.setProperty("--turn-ms", TURN_MS + "ms");
  if (scrubber) scrubber.max = String(LEAF_COUNT);

  function pageSrc(page) {
    return reader.dataset.pagesDir + "p-" + String(page).padStart(2, "0") + ".jpg";
  }

  function readPref(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function writePref(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* storage unavailable */ }
  }

  // ---------- Timers: every delayed action is tracked so a close or reopen can cancel it ----------
  const timers = new Set();
  const pendingLeaf = new Map();

  function later(fn, ms) {
    const id = window.setTimeout(function () {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function cancel(id) {
    window.clearTimeout(id);
    timers.delete(id);
  }

  function clearTimers() {
    timers.forEach(function (id) { window.clearTimeout(id); });
    timers.clear();
    pendingLeaf.clear();
    activeTurns = 0;
  }

  // ---------- Build the leaves ----------
  const leaves = [];
  const faces = [];

  function makeFace(faceSide, page, leafIndex) {
    const face = doc.createElement("div");
    face.className = "cure-face cure-face--" + faceSide;
    if (page <= PAGE_COUNT) {
      const image = doc.createElement("img");
      image.alt = page === 1 ? "Front cover of The Cure" : "Page " + page;
      image.decoding = "async";
      image.draggable = false;
      image.dataset.src = pageSrc(page);
      image.addEventListener("error", function () {
        face.classList.add("is-missing");
        face.textContent = "PAGE " + page;
      });
      face.appendChild(image);
      face.dataset.page = String(page);
      if (leafIndex === 0 && faceSide === "back") {
        image.alt = "Inside cover";
        const mark = doc.createElement("p");
        mark.className = "cure-endpaper-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "THE CURE";
        face.appendChild(mark);
      }
    } else if (endTemplate) {
      face.classList.add("cure-face--end");
      face.appendChild(endTemplate.content.cloneNode(true));
    }
    faces.push(face);
    return face;
  }

  for (let k = 0; k < LEAF_COUNT; k += 1) {
    const leaf = doc.createElement("div");
    leaf.className = "cure-leaf" + (k === 0 ? " cure-leaf--cover" : "");
    leaf.style.setProperty("--lift", ((LEAF_COUNT - k) * 0.6).toFixed(1) + "px");
    leaf.appendChild(makeFace("front", 2 * k + 1, k));
    leaf.appendChild(makeFace("back", 2 * k + 2, k));
    book.appendChild(leaf);
    leaves.push(leaf);
  }

  const endFace = book.querySelector(".cure-face--end");
  const board = book.querySelector(".cure-board");

  function loadLeaves(from, to) {
    for (let k = Math.max(0, from - 1); k <= Math.min(LEAF_COUNT - 1, to + 1); k += 1) {
      leaves[k].querySelectorAll("img[data-src]").forEach(function (image) {
        image.src = image.dataset.src;
        image.removeAttribute("data-src");
      });
    }
  }

  // ---------- Paper sound (synthesised, no audio files) ----------
  let audio = null;
  let lastSwish = 0;
  // Off by default, like the rest of the site. The key was renamed so earlier visitors start muted too.
  let soundOn = readPref("cure-sound-v2") === "on";

  function swish(duration) {
    if (!soundOn || !reader.open) return;
    const now = performance.now();
    if (now - lastSwish < 45) return;
    lastSwish = now;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audio = audio || new AudioCtx();
      if (audio.state === "suspended") audio.resume();
      const t = audio.currentTime;
      const length = Math.max(0.16, Math.min(0.42, (duration || 600) / 1000 * 0.5));
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * length), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(650, t);
      filter.frequency.exponentialRampToValueAtTime(3400, t + length * 0.7);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      source.start(t);
      source.stop(t + length + 0.02);
    } catch (error) {
      soundOn = false;
    }
  }

  function renderSoundToggle() {
    if (!soundToggle) return;
    soundToggle.setAttribute("aria-pressed", String(soundOn));
    soundToggle.textContent = soundOn ? "♪ Sound on" : "♪ Sound off";
  }

  // ---------- Turning ----------
  function clearPeek() {
    leaves.forEach(function (leaf) { leaf.classList.remove("is-peek"); });
  }

  // The newest instruction for a leaf always wins: any turn still waiting on its stagger is cancelled.
  function turnLeaf(index, turned, delay, duration) {
    if (pendingLeaf.has(index)) cancel(pendingLeaf.get(index));
    const id = later(function () {
      pendingLeaf.delete(index);
      const leaf = leaves[index];
      leaf.style.setProperty("--leaf-turn", duration + "ms");
      leaf.classList.remove("is-turning", "is-peek");
      void leaf.offsetWidth; // restart the shading animation
      leaf.classList.add("is-turning");
      leaf.classList.toggle("is-turned", turned);
      swish(duration);
      activeTurns += 1;
      later(function () {
        leaf.classList.remove("is-turning");
        activeTurns = Math.max(0, activeTurns - 1);
      }, duration + 60);
    }, delay);
    pendingLeaf.set(index, id);
  }

  // Turns to a spread (0 = closed cover, LEAF_COUNT = back board) and returns the total time.
  function goTo(target, options) {
    const opts = options || {};
    target = Math.max(0, Math.min(LEAF_COUNT, target));
    const from = spread;
    if (target === from) { update(opts); return 0; }
    const forward = target > from;
    const order = [];
    if (forward) for (let k = from; k < target; k += 1) order.push(k);
    else for (let k = from - 1; k >= target; k -= 1) order.push(k);

    const riffle = order.length > 1;
    const duration = opts.fast ? Math.min(RIFFLE_MS, 460) : (riffle ? RIFFLE_MS : TURN_MS);
    const stagger = opts.fast ? Math.min(STAGGER_MS, 35) : STAGGER_MS;
    const leadGap = opts.lead ? Math.round(TURN_MS * 0.45) : 0;

    spread = target;
    loadLeaves(Math.min(from, target), Math.max(from, target));
    clearPeek();
    let total = 0;
    order.forEach(function (index, i) {
      const isLead = i === 0 && opts.lead;
      const delay = i === 0 ? 0 : leadGap + (i - (opts.lead ? 1 : 0)) * stagger;
      const turnFor = isLead ? TURN_MS : duration;
      turnLeaf(index, forward, delay, turnFor);
      total = Math.max(total, delay + turnFor);
    });
    update(opts);
    return total;
  }

  function spreadForPage(page) {
    return page <= 1 ? 0 : Math.floor(page / 2);
  }

  function sideForPage(page) {
    return page <= 1 || page % 2 === 1 ? "right" : "left";
  }

  function jumpToPage(page, options) {
    side = sideForPage(page);
    return goTo(spreadForPage(page), options);
  }

  function busy() {
    return opening || closing;
  }

  function step(direction) {
    if (busy()) return;
    if (!singlePage.matches) { goTo(spread + direction); return; }
    if (direction > 0) {
      if (side === "left" && spread > 0) { side = "right"; update(); }
      else if (spread < LEAF_COUNT) { side = "left"; goTo(spread + 1); }
    } else if (side === "right" && spread > 0) {
      side = "left";
      update();
    } else if (spread > 0) {
      side = "right";
      goTo(spread - 1);
    }
  }

  // ---------- UI state ----------
  function currentPages() {
    if (spread === 0) return [1];
    const left = 2 * spread;
    const right = 2 * spread + 1;
    if (singlePage.matches) return [side === "left" ? left : right];
    return [left, right];
  }

  function visiblePages() {
    return currentPages().filter(function (page) { return page <= PAGE_COUNT; });
  }

  function chapterFor(page) {
    let found = chapters[0];
    chapters.forEach(function (chapter) { if (chapter.page <= page) found = chapter; });
    return found;
  }

  function describe() {
    if (spread === 0) return "Cover";
    if (spread === LEAF_COUNT && (!singlePage.matches || side === "left")) return "End of preview";
    if (spread === LEAF_COUNT) return "Back cover";
    const pages = visiblePages();
    const chapter = chapterFor(pages[pages.length - 1]);
    const range = pages.length > 1 ? "Pp. " + pages[0] + "–" + pages[1] : "P. " + pages[0];
    return range + " / " + PAGE_COUNT + (chapter ? " · " + chapter.name : "");
  }

  function announce(text, immediate) {
    if (!live) return;
    window.clearTimeout(liveTimer);
    // Debounced so dragging the scrubber or a riffle announces once, where it lands.
    liveTimer = window.setTimeout(function () { live.textContent = text; }, immediate ? 0 : 450);
  }

  function isVisibleFace(face) {
    const leafIndex = leaves.indexOf(face.parentElement);
    const isFront = face.classList.contains("cure-face--front");
    if (spread === 0) return leafIndex === 0 && isFront;
    const leftShown = !singlePage.matches || side === "left";
    const rightShown = !singlePage.matches || side === "right";
    if (leftShown && leafIndex === spread - 1 && !isFront) return true;
    return rightShown && leafIndex === spread && isFront;
  }

  function isUnusable(element) {
    return element.disabled || element.hidden || Boolean(element.closest("[inert]")) ||
      window.getComputedStyle(element).visibility === "hidden";
  }

  function update(options) {
    const opts = options || {};
    const single = singlePage.matches;
    const focused = doc.activeElement;
    let shift = "0%";
    if (single) shift = spread === 0 || side === "right" ? "-50%" : "0%";
    else if (spread === 0) shift = "-25%";
    book.style.setProperty("--shift", shift);
    book.style.setProperty("--left-stack", (Math.min(spread, 12) * 0.6).toFixed(1) + "px");
    book.style.setProperty("--right-stack", (Math.min(LEAF_COUNT - spread, 12) * 0.6).toFixed(1) + "px");

    const text = describe();
    if (label) label.textContent = text;
    if (!opts.quiet) announce(text, false);
    if (scrubber) {
      scrubber.value = String(spread);
      scrubber.setAttribute("aria-valuetext", text);
    }
    if (progress) progress.style.setProperty("--progress", (spread / LEAF_COUNT).toFixed(3));
    if (prevButton) prevButton.disabled = spread === 0;
    if (nextButton) nextButton.disabled = spread === LEAF_COUNT && (!single || side === "right");
    if (chapterSelect) {
      const chapter = spread > 0 ? chapterFor(visiblePages().slice(-1)[0] || PAGE_COUNT) : chapters[0];
      if (chapter) chapterSelect.value = String(chapter.page);
    }
    if (footerRestart) footerRestart.classList.toggle("is-hidden", spread <= spreadForPage(START_PAGE));
    if (endFace) endFace.inert = spread !== LEAF_COUNT;
    faces.forEach(function (face) {
      face.setAttribute("aria-hidden", isVisibleFace(face) ? "false" : "true");
    });
    if (board) board.setAttribute("aria-hidden", "true");
    loadLeaves(spread - 1, spread + 1);

    // Keep keyboard focus inside the reader when the control that had it just disabled or hid itself.
    if (reader.open && focused && reader.contains(focused) && isUnusable(focused)) {
      const fallback = [nextButton, prevButton, closeButton].find(function (button) {
        return button && !isUnusable(button);
      });
      if (fallback) fallback.focus({ preventScroll: true });
    }

    if (!busy()) {
      const page = spread === LEAF_COUNT ? START_PAGE : (visiblePages()[0] || START_PAGE);
      if (spread > 0) writePref("cure-page", String(page));
    }
  }

  // ---------- Flight between the page and the reader ----------
  function flightTransform() {
    const source = pageCover ? pageCover.querySelector("img") : null;
    const coverFace = leaves[0].querySelector(".cure-face--front");
    if (!source || !coverFace) return null;
    const to = source.getBoundingClientRect();
    const cover = coverFace.getBoundingClientRect();
    const frame = flight.getBoundingClientRect();
    if (!to.width || !cover.width) return null;
    const scale = to.width / cover.width;
    const x = to.left - frame.left - (cover.left - frame.left) * scale;
    const y = to.top - frame.top - (cover.top - frame.top) * scale;
    return "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px) scale(" + scale.toFixed(4) + ")";
  }

  function fly(inbound, done) {
    const away = reduceMotion ? null : flightTransform();
    if (!away) { flight.style.transform = ""; done(); return; }
    if (inbound) {
      flight.style.transition = "none";
      flight.style.transform = away;
      void flight.offsetWidth;
      flight.style.transition = "transform " + FLIGHT_MS + "ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      flight.style.transform = "none";
    } else {
      flight.style.transition = "transform " + FLIGHT_MS + "ms cubic-bezier(0.6, 0, 0.8, 0.4)";
      flight.style.transform = away;
    }
    later(done, FLIGHT_MS);
  }

  function resumePage() {
    const saved = Number(readPref("cure-page"));
    return saved > START_PAGE && saved <= PAGE_COUNT ? saved : START_PAGE;
  }

  function setDialogOpen(open) {
    // Another site dialog (e.g. the terminal) may still be open underneath or on top.
    body.classList.toggle("dialog-open", open || Boolean(doc.querySelector("dialog[open]")));
  }

  function openReader(trigger) {
    if (reader.open) return;
    clearTimers();
    session += 1;
    const mySession = session;
    lastTrigger = trigger;
    opening = true;
    flyingIn = true;
    closing = false;
    pendingClose = false;
    reader.classList.remove("is-closing");
    reader.classList.add("is-resetting", "is-opening");
    leaves.forEach(function (leaf) { leaf.classList.remove("is-turned", "is-turning", "is-peek"); });
    spread = 0;
    side = "right";
    loadLeaves(0, 3);
    update({ quiet: true });
    reader.showModal();
    setDialogOpen(true);
    if (pageCover) pageCover.classList.add("is-lifted");
    renderSoundToggle();

    const target = resumePage();
    void reader.offsetWidth;
    fly(true, function () {
      if (mySession !== session) return;
      flyingIn = false;
      reader.classList.remove("is-resetting");
      if (pendingClose) {
        opening = false;
        reader.classList.remove("is-opening");
        closeReader();
        return;
      }
      const total = jumpToPage(target, { lead: true, quiet: true });
      later(function () {
        if (mySession !== session || closing) return;
        opening = false;
        reader.classList.remove("is-opening");
        update();
      }, total);
    });
  }

  function closeReader() {
    if (!reader.open || closing) return;
    // Let the book finish landing before it flies back; the close follows immediately.
    if (flyingIn) { pendingClose = true; return; }
    const mySession = session;
    closing = true;
    opening = false;
    reader.classList.remove("is-opening");
    reader.classList.add("is-closing");
    clearPeek();
    side = "right";
    const back = goTo(0, { fast: true, quiet: true });
    // Wait for both the leaves and the book's slide back to the closed position,
    // so the flight measures where the cover really ends up.
    later(function () {
      if (mySession !== session) return;
      fly(false, function () {
        if (mySession === session && reader.open) reader.close();
      });
    }, back ? Math.max(back, SHIFT_MS) + 60 : 0);
  }

  reader.addEventListener("close", function () {
    clearTimers();
    session += 1;
    closing = false;
    opening = false;
    flyingIn = false;
    pendingClose = false;
    reader.classList.remove("is-closing", "is-opening", "is-resetting");
    flight.style.transition = "none";
    flight.style.transform = "";
    setDialogOpen(false);
    if (pageCover) pageCover.classList.remove("is-lifted");
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus({ preventScroll: true });
  });

  reader.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeReader();
  });

  // ---------- Inputs ----------
  doc.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-book-open]");
    if (!trigger) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openReader(trigger);
  });

  reader.addEventListener("click", function (event) {
    if (event.target.closest("[data-book-close]")) { closeReader(); return; }
    if (event.target.closest("[data-book-restart]")) {
      if (!busy()) jumpToPage(START_PAGE);
      return;
    }
    if (event.target.closest("[data-book-prev]")) { step(-1); return; }
    if (event.target.closest("[data-book-next]")) { step(1); return; }
    if (event.target.closest("[data-book-sound]")) {
      soundOn = !soundOn;
      writePref("cure-sound-v2", soundOn ? "on" : "off");
      renderSoundToggle();
      if (soundOn) swish(500);
    }
  });

  stage.addEventListener("click", function (event) {
    if (performance.now() < suppressClickUntil) return;
    if (event.target.closest("a, button")) return;
    const box = (singlePage.matches ? stage : book).getBoundingClientRect();
    step(event.clientX > box.left + box.width / 2 ? 1 : -1);
  });

  let pointerStart = null;
  stage.addEventListener("pointerdown", function (event) {
    pointerStart = { x: event.clientX, y: event.clientY };
    suppressClickUntil = 0;
  });
  stage.addEventListener("pointerup", function (event) {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      // A mouse drag still fires a click afterwards; a touch swipe does not.
      if (event.pointerType === "mouse") suppressClickUntil = performance.now() + 400;
      step(dx < 0 ? 1 : -1);
    }
  });

  // A corner lifts when the pointer nears the fore-edge.
  stage.addEventListener("pointermove", function (event) {
    if (event.pointerType !== "mouse" || busy() || activeTurns || singlePage.matches) return;
    const box = book.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    clearPeek();
    if (x > 0.9 && spread < LEAF_COUNT) leaves[spread].classList.add("is-peek");
    else if (x < 0.1 && spread > 0) leaves[spread - 1].classList.add("is-peek");
  });
  stage.addEventListener("pointerleave", clearPeek);

  // Listens on the document so keys keep working even if focus ends up on <body>.
  doc.addEventListener("keydown", function (event) {
    if (!reader.open || event.defaultPrevented) return;
    if (event.target.matches && event.target.matches("input, select, textarea")) return;
    const otherDialog = Array.from(doc.querySelectorAll("dialog[open]")).some(function (dialog) {
      return dialog !== reader;
    });
    if (otherDialog) return;
    if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); step(1); }
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); step(-1); }
    if (event.key === "Home") { event.preventDefault(); if (!busy()) jumpToPage(1); }
    if (event.key === "End") { event.preventDefault(); if (!busy()) { side = "left"; goTo(LEAF_COUNT); } }
  });

  if (scrubber) {
    scrubber.addEventListener("input", function () {
      if (busy()) { update({ quiet: true }); return; }
      const target = Number(scrubber.value);
      side = target === 0 ? "right" : "left";
      goTo(target);
    });
  }

  if (chapterSelect) {
    chapterSelect.addEventListener("change", function () {
      if (busy()) { update({ quiet: true }); return; }
      jumpToPage(Number(chapterSelect.value));
    });
  }

  function onModeChange() {
    if (reader.open) update({ quiet: true });
  }
  if (singlePage.addEventListener) singlePage.addEventListener("change", onModeChange);
  else singlePage.addListener(onModeChange);
})();
