(function () {
  "use strict";

  // Home hero photo window: the red title-bar dot is a real close button. Pressing it closes
  // the window with a quick shrink-and-fade, and a few seconds later the window bounces back
  // into its original spot (undoing any drag). Reduced motion swaps both for a plain fade.

  const doc = document;
  const win = doc.querySelector(".portrait-window");
  const closeButton = win && win.querySelector("[data-portrait-close]");
  if (!closeButton) return;

  const handle = win.querySelector("[data-drag-handle]");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const AWAY_MS = 2600;
  let busy = false;
  let closing = null;

  function reduced() {
    return Boolean((window.JBOS && window.JBOS.reduceMotion) || motionQuery.matches);
  }

  function play(name) {
    const sound = window.JBOS && window.JBOS.sound;
    if (sound && typeof sound.play === "function") sound.play(name);
  }

  function animate(keyframes, options) {
    if (typeof win.animate !== "function") return null;
    try { return win.animate(keyframes, options); } catch (error) { return null; }
  }

  // The drag code in site.js snaps the window home on a double-click of its title bar, which
  // also resets its own drag offset, so the next drag starts from the original spot.
  function snapHome() {
    if (handle) handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    win.style.translate = "";
  }

  function comeBack(hadFocus) {
    snapHome();
    if (closing) { closing.cancel(); closing = null; }
    win.classList.remove("is-closed");
    const back = reduced()
      ? animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" })
      : animate([
          { opacity: 0, scale: "0.55", translate: "0 -2.5rem", easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
          { opacity: 1, scale: "1.05", translate: "0 0", offset: 0.42, easing: "cubic-bezier(0.3, 0, 0.5, 1)" },
          { opacity: 1, scale: "0.97", translate: "0 -0.7rem", offset: 0.6, easing: "cubic-bezier(0.5, 0, 0.7, 1)" },
          { opacity: 1, scale: "1.02", translate: "0 0", offset: 0.76, easing: "cubic-bezier(0.3, 0, 0.5, 1)" },
          { opacity: 1, scale: "0.995", translate: "0 -0.2rem", offset: 0.89, easing: "cubic-bezier(0.5, 0, 0.7, 1)" },
          { opacity: 1, scale: "1", translate: "0 0" }
        ], { duration: 900 });
    play("pop");
    function done() {
      busy = false;
      if (hadFocus) closeButton.focus({ preventScroll: true });
    }
    if (back && back.finished) back.finished.then(done, done);
    else done();
  }

  closeButton.addEventListener("pointerdown", function (event) {
    // The button sits inside the title bar, which is the drag handle.
    event.stopPropagation();
  });

  closeButton.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    busy = true;
    const hadFocus = doc.activeElement === closeButton && event.detail === 0;
    play("close");
    closing = reduced()
      ? animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" })
      : animate([
          { opacity: 1, scale: "1", rotate: "0deg", easing: "cubic-bezier(0.3, 0, 0.7, 1)" },
          { opacity: 1, scale: "1.03", rotate: "0deg", offset: 0.18, easing: "cubic-bezier(0.55, 0, 0.9, 0.4)" },
          { opacity: 0, scale: "0.12", rotate: "-9deg" }
        ], { duration: 460, fill: "forwards" });
    function hide() {
      win.classList.add("is-closed");
      window.setTimeout(function () { comeBack(hadFocus); }, AWAY_MS);
    }
    if (closing && closing.finished) closing.finished.then(hide, hide);
    else hide();
  });
})();
