(function () {
  "use strict";

  // Every window with the three title-bar dots (the home photo, the project previews on /code/,
  // the story's chapter bars, timeline cards and stack windows, the creative page, the 404 page)
  // gets a real close button: the first dot. Pressing it closes that window with a quick
  // shrink-and-fade, and a few seconds later the window bounces back into its original spot
  // (undoing any drag). The terminal keeps its own close, and menus are left alone.
  // Reduced motion swaps both animations for a plain fade.

  const doc = document;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const AWAY_MS = 2600;
  const busy = new WeakSet();

  function reduced() {
    return Boolean((window.JBOS && window.JBOS.reduceMotion) || motionQuery.matches);
  }

  function play(name) {
    const sound = window.JBOS && window.JBOS.sound;
    if (!sound || typeof sound.play !== "function") return;
    try { sound.play(name); } catch (error) { /* sound is optional */ }
  }

  function animate(element, keyframes, options) {
    if (typeof element.animate !== "function") return null;
    try { return element.animate(keyframes, options); } catch (error) { return null; }
  }

  function afterAnimation(animation, callback) {
    if (animation && animation.finished) animation.finished.then(callback, callback);
    else callback();
  }

  // The element that visually is the window for a set of dots.
  function windowFor(dots) {
    if (dots.tagName === "BUTTON" || dots.closest("dialog, .theme-popover")) return null;
    // A story chapter's title bar belongs to the whole full-screen chapter window.
    if (dots.closest(".story-tab")) return dots.closest(".story-stage");
    return dots.closest("[data-window], .story-card__body, .album-flip, .window");
  }

  // The first non-empty text in the title bar, for the button's label.
  function titleFor(dots) {
    const bar = dots.parentElement;
    if (!bar) return "";
    const parts = Array.prototype.filter.call(bar.children, function (child) {
      return child !== dots && !child.contains(dots);
    });
    for (let index = 0; index < parts.length; index += 1) {
      const text = parts[index].textContent.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return "";
  }

  // The dots (and some whole title bars) are aria-hidden decoration. Now that one dot is a real
  // button, un-hide the path down to it and keep everything beside that path hidden.
  function exposeButton(button, win) {
    let hidden = button.parentElement && button.parentElement.closest('[aria-hidden="true"]');
    while (hidden && win.contains(hidden)) {
      hidden.removeAttribute("aria-hidden");
      let node = button;
      while (node && node !== hidden && node.parentElement) {
        Array.prototype.forEach.call(node.parentElement.children, function (sibling) {
          if (sibling !== node && !sibling.hasAttribute("aria-hidden")) sibling.setAttribute("aria-hidden", "true");
        });
        node = node.parentElement;
      }
      hidden = button.parentElement.closest('[aria-hidden="true"]');
    }
    // Still inside something hidden from assistive tech: keep it out of the tab order too.
    if (button.parentElement.closest('[aria-hidden="true"]')) button.tabIndex = -1;
  }

  // Resting pose, so a window that is tilted, scaled or dragged starts from where it is.
  function pose(win) {
    const style = window.getComputedStyle(win);
    const rotate = style.rotate && style.rotate !== "none" ? parseFloat(style.rotate) || 0 : 0;
    const scale = style.scale && style.scale !== "none" ? parseFloat(style.scale) || 1 : 1;
    const shift = style.translate && style.translate !== "none" ? style.translate.split(" ") : [];
    const opacity = parseFloat(style.opacity);
    return {
      rotate: rotate,
      scale: scale,
      x: shift[0] || "0px",
      y: shift[1] || "0px",
      opacity: isNaN(opacity) ? 1 : opacity
    };
  }

  // The drag code in site.js snaps a draggable window home on a double-click of its title bar,
  // which also resets its own drag offset, so the next drag starts from the original spot.
  function snapHome(win) {
    if (!win.hasAttribute("data-draggable")) return;
    const handle = win.querySelector("[data-drag-handle]");
    if (handle) handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    win.style.translate = "";
  }

  function closeWindow(win, button, byKeyboard) {
    if (busy.has(win)) return;
    busy.add(win);
    play("close");

    const start = pose(win);
    const closing = reduced()
      ? animate(win, [{ opacity: start.opacity }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" })
      : animate(win, [
          { opacity: start.opacity, scale: String(start.scale), rotate: start.rotate + "deg", easing: "cubic-bezier(0.3, 0, 0.7, 1)" },
          { opacity: start.opacity, scale: String(start.scale * 1.03), rotate: start.rotate + "deg", offset: 0.18, easing: "cubic-bezier(0.55, 0, 0.9, 0.4)" },
          { opacity: 0, scale: String(start.scale * 0.12), rotate: (start.rotate - 9) + "deg" }
        ], { duration: 460, fill: "forwards" });

    afterAnimation(closing, function () {
      win.classList.add("is-window-closed");
      window.setTimeout(function () {
        snapHome(win);
        if (closing) closing.cancel();
        win.classList.remove("is-window-closed");
        const home = pose(win);
        const at = function (scale, lift) {
          return {
            opacity: start.opacity,
            scale: String(home.scale * scale),
            translate: home.x + " calc(" + home.y + " - " + lift + "rem)"
          };
        };
        const back = reduced()
          ? animate(win, [{ opacity: 0 }, { opacity: start.opacity }], { duration: 320, easing: "ease-out" })
          : animate(win, [
              Object.assign(at(0.55, 2.5), { opacity: 0, easing: "cubic-bezier(0.3, 0, 0.6, 1)" }),
              Object.assign(at(1.05, 0), { offset: 0.42, easing: "cubic-bezier(0.3, 0, 0.5, 1)" }),
              Object.assign(at(0.97, 0.7), { offset: 0.6, easing: "cubic-bezier(0.5, 0, 0.7, 1)" }),
              Object.assign(at(1.02, 0), { offset: 0.76, easing: "cubic-bezier(0.3, 0, 0.5, 1)" }),
              Object.assign(at(0.995, 0.2), { offset: 0.89, easing: "cubic-bezier(0.5, 0, 0.7, 1)" }),
              at(1, 0)
            ], { duration: 900 });
        play("pop");
        afterAnimation(back, function () {
          busy.delete(win);
          if (byKeyboard && button.isConnected) button.focus({ preventScroll: true });
        });
      }, AWAY_MS);
    });
  }

  function enhance(dots) {
    const win = windowFor(dots);
    const first = dots.firstElementChild;
    if (!win || !first || dots.querySelector(".window-close")) return;

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "window-close";
    const title = titleFor(dots);
    button.setAttribute("aria-label", title ? "Close " + title : "Close window");
    button.setAttribute("data-cursor", "CLOSE");
    const dot = doc.createElement("i");
    dot.setAttribute("aria-hidden", "true");
    button.appendChild(dot);
    dots.replaceChild(button, first);
    exposeButton(button, win);

    // The title bar is the drag handle on draggable windows.
    button.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeWindow(win, button, event.detail === 0);
    });
  }

  doc.querySelectorAll(".window-controls, .story-tab__dots").forEach(enhance);
})();
