(function () {
  "use strict";

  const doc = document;
  const root = doc.documentElement;
  const body = doc.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function showToast(message) {
    const toast = doc.querySelector(".system-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  // Public hooks for the theme, easter-egg, sound and home modules loaded after this file.
  // Modules add terminal commands with JBOS.registerCommand(name, { run(args, raw), help, hidden, aliases }).
  const JBOS = window.JBOS = window.JBOS || {};
  JBOS.commands = JBOS.commands || {};
  JBOS.aliases = JBOS.aliases || {};
  JBOS.events = JBOS.events || new EventTarget();
  JBOS.reduceMotion = reduceMotion;
  JBOS.finePointer = finePointer;
  JBOS.toast = showToast;
  JBOS.sound = JBOS.sound || { enabled: false, play: function () {} };
  JBOS.registerCommand = function (name, spec) {
    JBOS.commands[name] = spec;
    (spec.aliases || []).forEach(function (alias) { JBOS.aliases[alias] = name; });
  };
  JBOS.on = function (type, handler) {
    JBOS.events.addEventListener(type, function (event) { handler(event.detail); });
  };
  JBOS.emit = function (type, detail) {
    JBOS.events.dispatchEvent(new CustomEvent(type, { detail: detail }));
  };

  // Only show the boot sequence once per browsing session.
  try {
    if (window.sessionStorage.getItem("jb-booted")) {
      root.classList.add("boot-skipped");
    } else {
      window.sessionStorage.setItem("jb-booted", "true");
    }
  } catch (error) {
    // Storage can be unavailable in hardened browser modes; the CSS fallback still exits.
  }

  // Reveal the About copy like a quick terminal transcript without changing its layout.
  if (!reduceMotion) {
    let typedWordIndex = 0;
    doc.querySelectorAll("[data-word-type]").forEach(function (block) {
      const words = block.textContent.trim().split(/\s+/);
      const fragment = doc.createDocumentFragment();
      block.textContent = "";

      words.forEach(function (word, index) {
        if (index) fragment.appendChild(doc.createTextNode(" "));
        const token = doc.createElement("span");
        token.className = "type-word";
        token.textContent = word;
        token.style.setProperty("--word-index", typedWordIndex);
        typedWordIndex += 1;
        fragment.appendChild(token);
      });

      block.appendChild(fragment);
      block.classList.add("word-type-ready");
    });
  }

  // Mobile navigation.
  const navToggle = doc.querySelector(".nav-toggle");
  const primaryNav = doc.querySelector(".primary-nav");
  if (navToggle && primaryNav) {
    navToggle.addEventListener("click", function () {
      const open = body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    primaryNav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        body.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });

    const desktopNav = window.matchMedia("(min-width: 901px)");
    function resetMobileNav(event) {
      if (!event.matches) return;
      body.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
    if (desktopNav.addEventListener) desktopNav.addEventListener("change", resetMobileNav);
    else desktopNav.addListener(resetMobileNav);
  }

  // One-time, accessible scroll reveals.
  const revealItems = Array.from(doc.querySelectorAll(".reveal"));
  function revealItem(item, observer) {
    item.classList.add("is-visible");
    if (observer) observer.unobserve(item);
  }

  function revealAll() {
    revealItems.forEach(function (item) { revealItem(item); });
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealAll();
  } else {
    try {
      const revealObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          revealItem(entry.target, observer);
        });
      }, { threshold: 0, rootMargin: "0px 0px 10% 0px" });

      revealItems.forEach(function (item, index) {
        item.style.transitionDelay = Math.min(index % 4, 3) * 45 + "ms";
        revealObserver.observe(item);
      });
      root.classList.add("reveal-ready");

      let revealResizeQueued = false;
      function revealInRange() {
        const revealLine = window.innerHeight * 1.05;
        revealItems.forEach(function (item) {
          if (item.classList.contains("is-visible")) return;
          if (item.getBoundingClientRect().top <= revealLine) revealItem(item, revealObserver);
        });
        revealResizeQueued = false;
      }

      window.requestAnimationFrame(revealInRange);
      window.addEventListener("pageshow", revealInRange);
      window.addEventListener("resize", function () {
        if (revealResizeQueued) return;
        revealResizeQueued = true;
        window.requestAnimationFrame(revealInRange);
      }, { passive: true });
    } catch (error) {
      root.classList.remove("reveal-ready");
      revealAll();
    }
  }

  // Scroll progress meter. The page height is measured only when it changes, and the scroll
  // position is read in the scroll event (the start of the frame), so drawing the bar never
  // forces a style or layout pass in the middle of other scripts' animation frames.
  const progressBar = doc.querySelector(".scroll-progress i");
  let progressQueued = false;
  let scrollable = 1;
  let scrollTop = window.scrollY;
  function measureScrollable() {
    scrollable = Math.max(doc.documentElement.scrollHeight - window.innerHeight, 1);
  }
  function updateProgress() {
    const progress = Math.min(Math.max(scrollTop / scrollable, 0), 1);
    if (progressBar) progressBar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
    progressQueued = false;
  }
  function queueProgress() {
    if (progressQueued) return;
    progressQueued = true;
    window.requestAnimationFrame(updateProgress);
  }
  window.addEventListener("scroll", function () {
    scrollTop = window.scrollY;
    queueProgress();
  }, { passive: true });
  window.addEventListener("resize", function () { measureScrollable(); queueProgress(); }, { passive: true });
  window.addEventListener("load", function () { measureScrollable(); queueProgress(); });
  if ("ResizeObserver" in window) {
    new ResizeObserver(function () { measureScrollable(); queueProgress(); }).observe(body);
  }
  measureScrollable();
  updateProgress();

  // Custom pixel cursor with a softly trailing reticle. It turns light over dark surfaces: a
  // data-cursor-tone="dark" or "light" on the way up from the element decides, otherwise the
  // background colour behind the pointer does. It re-checks after a scroll as well, because the
  // page can move under a mouse that is standing still (wheel, trackpad, keys). The reticle only
  // animates while it is catching up, and the label is only rewritten when it changes.
  if (finePointer && !reduceMotion) {
    const dot = doc.querySelector(".cursor-dot");
    const reticle = doc.querySelector(".cursor-reticle");
    const label = reticle ? reticle.querySelector("span") : null;
    if (dot && reticle) {
      let mouseX = -100;
      let mouseY = -100;
      let trailX = -100;
      let trailY = -100;
      let pointerIn = false;
      let cursorSurface = null;
      let labelText = "";
      let trailing = false;
      let toneCache = new WeakMap();

      // Relative luminance of an opaque-enough colour, or null for a see-through one.
      function luminance(color) {
        const match = /rgba?\(([^)]+)\)/.exec(color || "");
        if (!match) return null;
        const parts = match[1].split(/[\s,/]+/).map(parseFloat);
        const alpha = parts.length > 3 && !isNaN(parts[3]) ? parts[3] : 1;
        if (alpha < 0.5) return null;
        const channel = function (value) {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
      }

      // "dark" or "light": the surface an element sits on. Cached per element (cleared when the
      // theme changes), so the walk up the tree runs once per element, not on every move.
      function toneOf(element) {
        const path = [];
        let node = element;
        let tone = null;
        while (node && node.nodeType === 1) {
          if (toneCache.has(node)) { tone = toneCache.get(node); break; }
          path.push(node);
          const hint = node.getAttribute("data-cursor-tone");
          if (hint === "dark" || hint === "light") { tone = hint; break; }
          const lum = luminance(window.getComputedStyle(node).backgroundColor);
          // 0.18 is where black and white text have equal contrast on a colour.
          if (lum !== null) { tone = lum < 0.18 ? "dark" : "light"; break; }
          node = node.parentElement;
        }
        tone = tone || "light";
        path.forEach(function (item) { toneCache.set(item, tone); });
        return tone;
      }

      function refresh(target) {
        const element = target && target.nodeType === 1 ? target : null;
        const interactive = element && element.closest ? element.closest("[data-cursor], a, button") : null;
        body.classList.toggle("cursor-active", Boolean(interactive));
        body.classList.toggle("cursor-on-close", Boolean(interactive && interactive.classList.contains("window-close")));
        if (element !== cursorSurface) {
          cursorSurface = element;
          body.classList.toggle("cursor-on-dark", Boolean(element) && toneOf(element) === "dark");
        }
        const text = interactive
          ? (interactive.getAttribute("data-cursor") || (interactive.tagName === "A" ? "OPEN" : "CLICK"))
          : "";
        if (label && text !== labelText) {
          labelText = text;
          label.textContent = text;
        }
      }

      function drawCursor() {
        trailX += (mouseX - trailX) * 0.17;
        trailY += (mouseY - trailY) * 0.17;
        const settled = Math.abs(mouseX - trailX) < 0.15 && Math.abs(mouseY - trailY) < 0.15;
        if (settled) {
          trailX = mouseX;
          trailY = mouseY;
        }
        reticle.style.transform = "translate3d(" + trailX.toFixed(2) + "px," + trailY.toFixed(2) + "px,0)";
        if (settled) {
          trailing = false;
          return;
        }
        window.requestAnimationFrame(drawCursor);
      }

      function trail() {
        if (trailing) return;
        trailing = true;
        window.requestAnimationFrame(drawCursor);
      }

      body.classList.add("cursor-ready");
      window.addEventListener("pointermove", function (event) {
        mouseX = event.clientX;
        mouseY = event.clientY;
        pointerIn = true;
        dot.style.transform = "translate3d(" + mouseX + "px," + mouseY + "px,0)";
        refresh(event.target);
        trail();
      }, { passive: true });

      window.addEventListener("pointerout", function (event) {
        if (!event.relatedTarget) {
          pointerIn = false;
          body.classList.remove("cursor-active", "cursor-on-dark", "cursor-on-close");
          cursorSurface = null;
        }
      });

      // After a scroll, look again at whatever is under the still pointer (a few times a second
      // at most, in a timer between frames, when the page's styles are already up to date).
      let recheckQueued = false;
      function recheck() {
        recheckQueued = false;
        if (pointerIn) refresh(doc.elementFromPoint(mouseX, mouseY));
      }
      window.addEventListener("scroll", function () {
        if (!pointerIn || recheckQueued) return;
        recheckQueued = true;
        window.setTimeout(recheck, 90);
      }, { passive: true });

      JBOS.on("theme-change", function () {
        toneCache = new WeakMap();
        cursorSurface = null;
        window.setTimeout(recheck, 0);
      });

      trail();
    }
  }

  // Gallery lightbox. Open immediately with the thumbnail, then swap in the full image.
  const lightbox = doc.querySelector("#gallery-lightbox");
  let activeGallery = [];
  let activeImage = 0;
  let imageLoadToken = 0;

  function setDialogState(open) {
    // Stay locked while any other dialog (e.g. the book reader) is still open.
    body.classList.toggle("dialog-open", open || Boolean(doc.querySelector("dialog[open]")));
  }

  function dialogIsOpen(dialog) {
    return Boolean(dialog && (dialog.open || dialog.hasAttribute("open")));
  }

  function closeLightbox() {
    if (!lightbox || !dialogIsOpen(lightbox)) return;
    if (typeof lightbox.close === "function") lightbox.close();
    else {
      lightbox.removeAttribute("open");
      setDialogState(false);
    }
  }

  function preloadGalleryNeighbor(offset) {
    if (!activeGallery.length) return;
    const index = (activeImage + offset + activeGallery.length) % activeGallery.length;
    const href = activeGallery[index].getAttribute("href");
    if (!href) return;
    const preload = new Image();
    preload.src = new URL(href, window.location.href).href;
  }

  function renderLightbox() {
    if (!lightbox || !activeGallery.length) return;
    const link = activeGallery[activeImage];
    const source = link.querySelector("img");
    const image = lightbox.querySelector("figure img");
    const caption = lightbox.querySelector("figcaption span");
    const count = lightbox.querySelector("figcaption small");
    const href = link.getAttribute("href");
    const alt = source ? source.alt : "Portfolio image";
    const thumbnail = source ? (source.currentSrc || source.src) : "";
    const token = ++imageLoadToken;

    if (!image || !caption || !count || !href) return;
    lightbox.classList.add("is-loading");
    lightbox.setAttribute("aria-busy", "true");
    image.src = thumbnail;
    image.alt = alt;
    caption.textContent = alt;
    count.textContent = String(activeImage + 1).padStart(2, "0") + " / " + String(activeGallery.length).padStart(2, "0");

    const fullImage = new Image();
    fullImage.onload = function () {
      if (token !== imageLoadToken) return;
      image.src = fullImage.src;
      lightbox.classList.remove("is-loading", "has-load-error");
      lightbox.removeAttribute("aria-busy");
      preloadGalleryNeighbor(-1);
      preloadGalleryNeighbor(1);
    };
    fullImage.onerror = function () {
      if (token !== imageLoadToken) return;
      lightbox.classList.remove("is-loading");
      lightbox.classList.add("has-load-error");
      lightbox.removeAttribute("aria-busy");
      count.textContent += " · PREVIEW ONLY";
    };
    fullImage.src = new URL(href, window.location.href).href;
  }

  function moveLightbox(direction) {
    activeImage = (activeImage + direction + activeGallery.length) % activeGallery.length;
    renderLightbox();
  }

  if (lightbox) {
    const lightboxClose = lightbox.querySelector(".lightbox-close");
    const lightboxPrevious = lightbox.querySelector(".lightbox-prev");
    const lightboxNext = lightbox.querySelector(".lightbox-next");

    doc.addEventListener("click", function (event) {
      const link = event.target.closest("[data-lightbox]");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();

      const group = link.getAttribute("data-lightbox");
      activeGallery = Array.from(doc.querySelectorAll("[data-lightbox]")).filter(function (candidate) {
        return candidate.getAttribute("data-lightbox") === group;
      });
      activeImage = Math.max(activeGallery.indexOf(link), 0);
      renderLightbox();

      if (!dialogIsOpen(lightbox)) {
        if (typeof lightbox.showModal === "function") lightbox.showModal();
        else lightbox.setAttribute("open", "");
      }
      setDialogState(true);
      if (lightboxClose) lightboxClose.focus({ preventScroll: true });
    });

    if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
    if (lightboxPrevious) lightboxPrevious.addEventListener("click", function () { moveLightbox(-1); });
    if (lightboxNext) lightboxNext.addEventListener("click", function () { moveLightbox(1); });
    lightbox.addEventListener("close", function () {
      imageLoadToken += 1;
      setDialogState(false);
    });
    lightbox.addEventListener("cancel", function () { setDialogState(false); });
    doc.addEventListener("keydown", function (event) {
      if (!dialogIsOpen(lightbox)) return;
      if (event.key === "ArrowLeft") moveLightbox(-1);
      if (event.key === "ArrowRight") moveLightbox(1);
    });
  }

  // Fast pixel-shutter transitions for ordinary same-origin navigation.
  doc.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;
    const rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.charAt(0) === "#" || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return;

    let destination;
    try { destination = new URL(link.href, window.location.href); } catch (error) { return; }
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;

    event.preventDefault();
    body.classList.remove("nav-open");
    body.classList.add("is-leaving");
    window.setTimeout(function () { window.location.href = destination.href; }, reduceMotion ? 0 : 430);
  });

  window.addEventListener("pageshow", function () {
    body.classList.remove("is-leaving");
  });

  // Subtle card tilt, intentionally capped so copy remains easy to read.
  if (finePointer && !reduceMotion) {
    doc.querySelectorAll(".tilt-card:not([data-draggable])").forEach(function (card) {
      card.addEventListener("pointermove", function (event) {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = "perspective(1000px) rotateX(" + (-y * 2.5) + "deg) rotateY(" + (x * 2.5) + "deg)";
      });
      card.addEventListener("pointerleave", function () {
        card.style.transform = "perspective(1000px) rotateX(0) rotateY(0)";
      });
    });

    doc.querySelectorAll(".cta").forEach(function (button) {
      button.addEventListener("pointermove", function (event) {
        const rect = button.getBoundingClientRect();
        const x = (event.clientX - rect.left - rect.width / 2) * 0.06;
        const y = (event.clientY - rect.top - rect.height / 2) * 0.08;
        button.style.translate = x + "px " + y + "px";
      });
      button.addEventListener("pointerleave", function () { button.style.translate = "0 0"; });
    });
  }

  // The portrait window can be nudged around on desktop; it snaps back on double-click.
  if (finePointer && !reduceMotion) {
    doc.querySelectorAll("[data-draggable]").forEach(function (item) {
      const handle = item.querySelector("[data-drag-handle]") || item;
      let originX = 0;
      let originY = 0;
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;

      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        startX = event.clientX;
        startY = event.clientY;
        originX = currentX;
        originY = currentY;
        item.classList.add("is-dragging");
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", function (event) {
        if (!item.classList.contains("is-dragging")) return;
        currentX = originX + event.clientX - startX;
        currentY = originY + event.clientY - startY;
        item.style.translate = currentX + "px " + currentY + "px";
      });
      function stopDrag() { item.classList.remove("is-dragging"); }
      handle.addEventListener("pointerup", stopDrag);
      handle.addEventListener("pointercancel", stopDrag);
      handle.addEventListener("dblclick", function () {
        currentX = 0;
        currentY = 0;
        item.style.translate = "0 0";
      });
    });
  }

  // Terminal easter egg: click the chrome glyph or press backtick.
  const terminal = doc.querySelector("#terminal-dialog");
  const terminalInput = doc.querySelector("#terminal-command");
  const terminalOutput = doc.querySelector("[data-terminal-output]");
  const terminalForm = doc.querySelector("[data-terminal-form]");
  const terminalDragHandle = terminal
    ? terminal.querySelector("[data-terminal-drag-handle]")
    : null;
  let terminalPointer = null;
  let terminalOffsetX = 0;
  let terminalOffsetY = 0;
  let terminalStartX = 0;
  let terminalStartY = 0;
  let terminalStartOffsetX = 0;
  let terminalStartOffsetY = 0;
  let terminalBaseLeft = 0;
  let terminalBaseTop = 0;
  let terminalWidth = 0;
  let terminalHeight = 0;

  function clampTerminalOffset(value, minimum, maximum) {
    if (minimum > maximum) return (minimum + maximum) / 2;
    return Math.min(Math.max(value, minimum), maximum);
  }

  function applyTerminalPosition() {
    if (!terminal) return;
    terminal.style.setProperty("--terminal-x", terminalOffsetX + "px");
    terminal.style.setProperty("--terminal-y", terminalOffsetY + "px");
  }

  function stopTerminalDrag(pointerId) {
    if (!terminalDragHandle || terminalPointer === null) return;
    if (pointerId !== undefined && pointerId !== terminalPointer) return;

    const capturedPointer = terminalPointer;
    terminalPointer = null;
    terminal.classList.remove("is-dragging");

    if (terminalDragHandle.hasPointerCapture(capturedPointer)) {
      terminalDragHandle.releasePointerCapture(capturedPointer);
    }
  }

  function resetTerminalPosition() {
    stopTerminalDrag();
    terminalOffsetX = 0;
    terminalOffsetY = 0;
    applyTerminalPosition();
  }

  if (terminalDragHandle) {
    terminalDragHandle.addEventListener("pointerdown", function (event) {
      if (!terminal || !terminal.open || event.button !== 0 || event.isPrimary === false) return;
      if (event.target.closest("button, a, input, textarea, select")) return;

      const rect = terminal.getBoundingClientRect();
      terminalPointer = event.pointerId;
      terminalStartX = event.clientX;
      terminalStartY = event.clientY;
      terminalStartOffsetX = terminalOffsetX;
      terminalStartOffsetY = terminalOffsetY;
      terminalBaseLeft = rect.left - terminalOffsetX;
      terminalBaseTop = rect.top - terminalOffsetY;
      terminalWidth = rect.width;
      terminalHeight = rect.height;

      event.preventDefault();
      terminal.classList.add("is-dragging");
      terminalDragHandle.setPointerCapture(event.pointerId);
    });

    terminalDragHandle.addEventListener("pointermove", function (event) {
      if (event.pointerId !== terminalPointer) return;

      const gutter = 8;
      const nextX = terminalStartOffsetX + event.clientX - terminalStartX;
      const nextY = terminalStartOffsetY + event.clientY - terminalStartY;

      terminalOffsetX = clampTerminalOffset(
        nextX,
        gutter - terminalBaseLeft,
        window.innerWidth - gutter - terminalBaseLeft - terminalWidth
      );
      terminalOffsetY = clampTerminalOffset(
        nextY,
        gutter - terminalBaseTop,
        window.innerHeight - gutter - terminalBaseTop - terminalHeight
      );

      applyTerminalPosition();
    });

    terminalDragHandle.addEventListener("pointerup", function (event) {
      stopTerminalDrag(event.pointerId);
    });
    terminalDragHandle.addEventListener("pointercancel", function (event) {
      stopTerminalDrag(event.pointerId);
    });
    terminalDragHandle.addEventListener("lostpointercapture", function () {
      stopTerminalDrag();
    });
    terminalDragHandle.addEventListener("dblclick", resetTerminalPosition);
  }

  function terminalLine(text, accent) {
    if (!terminalOutput) return null;
    const line = doc.createElement("p");
    line.textContent = text;
    if (accent) line.className = typeof accent === "string" ? accent : "terminal-output-accent";
    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    return line;
  }

  /* ---------- Command list: always the last thing in the log ---------- */
  // The plain-text help line ("COMMANDS: barrel · gravity · …"). It is one element that moves
  // to the end of the output when the terminal opens and after every command, so the commands
  // are always on screen without typing help, and the log never collects copies of it. While a
  // command is still printing (its run() returned a Promise that has not settled yet) the line
  // steps out of the log, and anything printed after it lands pulls it back to the end.
  const PROMPT = "visitor@jb:~$";
  let menu = null;
  let commandRun = 0;
  let commandBusy = false;

  // theme and gravity lead; everything else follows alphabetically, and clear comes last.
  const MENU_FIRST = ["theme", "gravity"];

  function menuText() {
    const fun = Object.keys(JBOS.commands).filter(function (name) {
      const spec = JBOS.commands[name];
      return spec && !spec.hidden && name !== "help" && name !== "clear";
    });
    const lead = MENU_FIRST.filter(function (name) { return fun.indexOf(name) >= 0; });
    const rest = fun.filter(function (name) { return MENU_FIRST.indexOf(name) < 0; }).sort();
    return "COMMANDS: " + lead.concat(rest, ["clear"]).join(" · ");
  }

  function placeMenu() {
    if (!terminalOutput || commandBusy) return;
    if (!menu) {
      menu = doc.createElement("p");
      menu.className = "terminal-output-accent";
    }
    const text = menuText();
    if (menu.textContent !== text) menu.textContent = text;
    if (terminalOutput.lastElementChild !== menu) terminalOutput.appendChild(menu);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function detachMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
  }

  // Output printed while no command is running (a "Did you mean", a stray timer, a game over
  // line) pulls the menu back to the end, so it is never stranded mid-log.
  if (terminalOutput && "MutationObserver" in window) {
    new MutationObserver(function () {
      if (commandBusy || !menu) return;
      if (menu.parentNode === terminalOutput) {
        if (terminalOutput.lastElementChild !== menu) placeMenu();
      } else if (terminal && terminal.open) {
        placeMenu();
      }
    }).observe(terminalOutput, { childList: true });
  }

  function settleCommand(run) {
    if (run !== commandRun) return;
    commandBusy = false;
    placeMenu();
  }

  // Runs a line as if it had been typed at the prompt.
  function runCommand(input) {
    const raw = String(input == null ? "" : input).trim();
    const run = ++commandRun;
    commandBusy = true;
    detachMenu();
    terminalLine(PROMPT + " " + raw);
    if (!raw) { settleCommand(run); return; }

    const parts = raw.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    const registered = JBOS.commands[command] || JBOS.commands[JBOS.aliases[command]];
    JBOS.emit("terminal-command", { command: command, args: args, raw: raw });

    // The terminal is for fun: easter-egg commands registered by the modules, plus help and clear.
    // `help` needs no output of its own: the command list lands right under it anyway.
    let result = null;
    if (command === "help") {
      settleCommand(run);
      return;
    }
    if (command === "clear") {
      terminalOutput.textContent = "";
    } else if (registered) {
      try {
        result = registered.run(args, raw);
      } catch (error) {
        terminalLine("Segmentation fault (core dumped): " + command);
      }
    } else {
      terminalLine("command not found: " + command);
    }

    if (result && typeof result.then === "function") {
      Promise.resolve(result).then(function () { settleCommand(run); }, function () { settleCommand(run); });
    } else {
      settleCommand(run);
    }
  }

  // Goes through the form, so input modes and other submit listeners see it like a typed line.
  function submitCommand(text) {
    if (terminalForm && terminalInput && typeof terminalForm.requestSubmit === "function") {
      terminalInput.value = text;
      terminalForm.requestSubmit();
    } else {
      runCommand(text);
    }
  }

  function openTerminal() {
    if (!terminal || terminal.open) return;
    resetTerminalPosition();
    terminal.showModal();
    setDialogState(true);
    placeMenu();
    window.setTimeout(function () { if (terminalInput) terminalInput.focus(); }, 20);
  }

  function closeTerminal() {
    if (terminal && terminal.open) terminal.close();
  }

  JBOS.terminal = {
    element: terminal,
    output: terminalOutput,
    input: terminalInput,
    print: terminalLine,
    run: submitCommand,
    clear: function () {
      if (!terminalOutput) return;
      terminalOutput.textContent = "";
      placeMenu();
    },
    open: openTerminal,
    close: closeTerminal
  };

  doc.querySelectorAll("[data-terminal-open]").forEach(function (trigger) {
    trigger.addEventListener("click", openTerminal);
  });
  const terminalClose = doc.querySelector("[data-terminal-close]");
  if (terminalClose) terminalClose.addEventListener("click", closeTerminal);
  if (terminal) {
    terminal.addEventListener("close", function () {
      resetTerminalPosition();
      setDialogState(false);
    });
    terminal.addEventListener("click", function (event) { if (event.target === terminal) closeTerminal(); });
  }

  window.addEventListener("resize", resetTerminalPosition, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resetTerminalPosition, { passive: true });
  }

  doc.addEventListener("keydown", function (event) {
    const typing = /INPUT|TEXTAREA|SELECT/.test(doc.activeElement ? doc.activeElement.tagName : "");
    if (event.key === "`" && !typing) {
      event.preventDefault();
      openTerminal();
    }
  });

  if (terminalForm) {
    terminalForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const raw = terminalInput.value;
      terminalInput.value = "";
      runCommand(raw);
    });
  }

  // Classic Konami sequence unlocks a brief arcade-state badge.
  const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiIndex = 0;
  doc.addEventListener("keydown", function (event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    konamiIndex = key === konami[konamiIndex] ? konamiIndex + 1 : (key === konami[0] ? 1 : 0);
    if (konamiIndex === konami.length) {
      konamiIndex = 0;
      body.classList.remove("game-mode");
      void body.offsetWidth;
      body.classList.add("game-mode");
      showToast("GAME MODE UNLOCKED · NICE WORK");
      window.setTimeout(function () { body.classList.remove("game-mode"); }, 2200);
    }
  });

  // Scramble the oversized hero name on hover, while preserving the DOM structure.
  const scrambleTarget = doc.querySelector("[data-scramble]");
  if (scrambleTarget && !reduceMotion) {
    const glyphs = "01<>/{}[]*#";
    const lines = Array.from(scrambleTarget.querySelectorAll("span"));
    lines.forEach(function (line) { line.dataset.original = line.textContent; });

    let scrambleTimer = null;
    let scrambleRun = 0;
    let pointerInsideScramble = false;

    function restoreScramble() {
      lines.forEach(function (line) { line.textContent = line.dataset.original; });
    }

    function stopScramble() {
      scrambleRun += 1;
      if (scrambleTimer !== null) window.clearInterval(scrambleTimer);
      scrambleTimer = null;
      restoreScramble();
    }

    function startScramble() {
      stopScramble();
      const run = scrambleRun;
      let frame = 0;
      const total = 15;
      scrambleTimer = window.setInterval(function () {
        if (run !== scrambleRun) return;
        lines.forEach(function (line) {
          const original = line.dataset.original;
          line.textContent = original.split("").map(function (character, index) {
            if (character === " ") return " ";
            if (index < (frame / total) * original.length) return original[index];
            return glyphs[Math.floor(Math.random() * glyphs.length)];
          }).join("");
        });
        frame += 1;
        if (frame > total) {
          window.clearInterval(scrambleTimer);
          scrambleTimer = null;
          restoreScramble();
        }
      }, 32);
    }

    function setScrambleHover(inside) {
      if (inside === pointerInsideScramble) return;
      pointerInsideScramble = inside;
      if (inside) startScramble();
      else stopScramble();
    }

    scrambleTarget.addEventListener("pointerenter", function () { setScrambleHover(true); });
    scrambleTarget.addEventListener("pointerleave", function () { setScrambleHover(false); });

    // Pointer movement is a fallback for embedded browsers that omit boundary events.
    window.addEventListener("pointermove", function (event) {
      const hoveredTarget = event.target.closest ? event.target.closest("[data-scramble]") : null;
      setScrambleHover(hoveredTarget === scrambleTarget);
    }, { passive: true });
  }

  // Eastern-time clock for the footer.
  const clock = doc.querySelector("#local-clock");
  function updateClock() {
    if (!clock) return;
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(new Date());
    clock.textContent = "ITHACA " + formatted + " ET";
  }
  updateClock();
  window.setInterval(updateClock, 30000);

  // Waves cover flips over to reveal the Apple Music player on its back.
  doc.querySelectorAll("[data-flip]").forEach(function (card) {
    const openButton = card.querySelector("[data-flip-open]");
    const closeButton = card.querySelector("[data-flip-close]");
    if (!openButton || !closeButton) return;
    // Matches the 425ms face swap in CSS; focus can only land once the face is visible.
    const swapDelay = reduceMotion ? 0 : 460;

    function setFlipped(flipped) {
      card.classList.toggle("is-flipped", flipped);
      openButton.setAttribute("aria-expanded", String(flipped));
      window.setTimeout(function () {
        (flipped ? closeButton : openButton).focus({ preventScroll: true });
      }, swapDelay);
    }

    openButton.addEventListener("click", function () { setFlipped(true); });
    closeButton.addEventListener("click", function () { setFlipped(false); });
    card.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && card.classList.contains("is-flipped")) setFlipped(false);
    });
  });
})();
