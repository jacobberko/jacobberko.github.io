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

  // Scroll progress meter.
  const progressBar = doc.querySelector(".scroll-progress i");
  let progressQueued = false;
  function updateProgress() {
    const scrollable = Math.max(doc.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
    if (progressBar) progressBar.style.transform = "scaleX(" + progress + ")";
    progressQueued = false;
  }
  window.addEventListener("scroll", function () {
    if (!progressQueued) {
      progressQueued = true;
      window.requestAnimationFrame(updateProgress);
    }
  }, { passive: true });
  updateProgress();

  // Custom pixel cursor with a softly trailing reticle.
  if (finePointer && !reduceMotion) {
    const dot = doc.querySelector(".cursor-dot");
    const reticle = doc.querySelector(".cursor-reticle");
    const label = reticle ? reticle.querySelector("span") : null;
    if (dot && reticle) {
      let mouseX = -100;
      let mouseY = -100;
      let trailX = -100;
      let trailY = -100;
      let cursorSurface = null;

      body.classList.add("cursor-ready");
      window.addEventListener("pointermove", function (event) {
        mouseX = event.clientX;
        mouseY = event.clientY;
        dot.style.transform = "translate3d(" + mouseX + "px," + mouseY + "px,0)";

        const interactive = event.target.closest("[data-cursor], a, button");
        const darkSurface = event.target.closest("[data-cursor-tone='dark'], .section-block--dark, .site-footer, .coursework-panel, .album-stage, .terminal, .lightbox");
        body.classList.toggle("cursor-active", Boolean(interactive));
        if (event.target !== cursorSurface) {
          cursorSurface = event.target;
          body.classList.toggle("cursor-on-dark", Boolean(darkSurface));
        }
        if (label) {
          label.textContent = interactive
            ? (interactive.getAttribute("data-cursor") || (interactive.tagName === "A" ? "OPEN" : "CLICK"))
            : "";
        }
      }, { passive: true });

      window.addEventListener("pointerout", function (event) {
        if (!event.relatedTarget) {
          body.classList.remove("cursor-active", "cursor-on-dark");
          cursorSurface = null;
        }
      });

      function drawCursor() {
        trailX += (mouseX - trailX) * 0.17;
        trailY += (mouseY - trailY) * 0.17;
        reticle.style.transform = "translate3d(" + trailX + "px," + trailY + "px,0)";
        window.requestAnimationFrame(drawCursor);
      }
      drawCursor();
    }
  }

  // Gallery lightbox. Open immediately with the thumbnail, then swap in the full image.
  const lightbox = doc.querySelector("#gallery-lightbox");
  let activeGallery = [];
  let activeImage = 0;
  let imageLoadToken = 0;

  function setDialogState(open) {
    body.classList.toggle("dialog-open", open);
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
  const routes = {
    home: "/",
    code: "/code/",
    creative: "/creative/",
    startup: "/business/",
    business: "/business/",
    photo: "/portfolio/"
  };

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
    if (!terminalOutput) return;
    const line = doc.createElement("p");
    line.textContent = text;
    if (accent) line.className = "terminal-output-accent";
    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function openTerminal() {
    if (!terminal || terminal.open) return;
    resetTerminalPosition();
    terminal.showModal();
    setDialogState(true);
    window.setTimeout(function () { if (terminalInput) terminalInput.focus(); }, 20);
  }

  function closeTerminal() {
    if (terminal && terminal.open) terminal.close();
  }

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
      const command = terminalInput.value.trim().toLowerCase();
      terminalLine("visitor@jb:~$ " + (command || ""));
      terminalInput.value = "";

      if (!command) return;
      if (routes[command]) {
        terminalLine("Opening " + command + "…", true);
        window.setTimeout(function () { window.location.href = routes[command]; }, 280);
        return;
      }
      if (command === "help") {
        terminalLine("COMMANDS: home · code · creative · startup · photo · contact · about · theme · clear", true);
      } else if (command === "about") {
        terminalLine("Jacob Berko — Cornell CS student, software engineer, founder, and creative builder.");
      } else if (command === "contact") {
        terminalLine("EMAIL: jmb787@cornell.edu · LINKEDIN: /in/jberko · GITHUB: @jacobberko", true);
      } else if (command === "theme") {
        body.classList.toggle("crt-mode");
        try { window.localStorage.setItem("jb-crt", body.classList.contains("crt-mode") ? "on" : "off"); } catch (error) {}
        terminalLine("CRT MODE " + (body.classList.contains("crt-mode") ? "ENABLED" : "DISABLED"), true);
      } else if (command === "clear") {
        terminalOutput.innerHTML = "";
      } else {
        terminalLine("Unknown command: " + command + ". Type help.");
      }
    });
  }

  // Restore the optional CRT mode.
  try {
    if (window.localStorage.getItem("jb-crt") === "on") body.classList.add("crt-mode");
  } catch (error) {}

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

  // Click-to-load Apple Music embed, with a manual fallback if it never responds.
  doc.querySelectorAll("[data-music-embed]").forEach(function (panel) {
    const trigger = panel.querySelector("[data-music-embed-trigger]");
    const src = panel.dataset.embedSrc;
    if (!trigger || !src) return;

    trigger.addEventListener("click", function () {
      const iframe = doc.createElement("iframe");
      iframe.title = panel.dataset.embedTitle || "Apple Music player";
      iframe.setAttribute("allow", "autoplay *; encrypted-media *;");
      iframe.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
      iframe.src = src;
      trigger.replaceWith(iframe);

      const fallbackTimer = window.setTimeout(function () {
        const notice = doc.createElement("p");
        notice.className = "music-player__fallback";
        notice.innerHTML = "Apple Music is taking a while to respond. <a href=\"" +
          src.replace("embed.music.apple.com", "music.apple.com") +
          "\" target=\"_blank\" rel=\"noopener noreferrer\">Open it directly instead ↗</a>";
        panel.appendChild(notice);
      }, 6000);

      iframe.addEventListener("load", function () {
        window.clearTimeout(fallbackTimer);
      }, { once: true });
    }, { once: true });
  });
})();
