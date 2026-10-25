// Progressive enhancement only: the page works without this file.
// - Waitlist: send the form with fetch and show the answer in place (without JS the browser posts the
//   form and the function redirects back to #waitlist-<code>, which CSS shows with :target).
// - Pix: copy the key to the clipboard.
// - Motion: reveal blocks as they scroll in, pause CSS loops off screen, play the hero loop and the clips
//   only while visible (never on their own with prefers-reduced-motion or Save-Data), count the
//   performance numbers. Without this file everything is simply shown, and videos have controls.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const hasIO = "IntersectionObserver" in window;
  const watch = (els, fn, opts) => {
    if (!hasIO || !els.length) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => fn(e.target, e.isIntersecting, io)), opts);
    els.forEach((el) => io.observe(el));
  };

  // Reveal on scroll. The observer's first report marks what is already on screen before .reveal hides
  // the rest, so nothing in view blinks (and no layout is forced while the page loads).
  if (!reduce && hasIO) {
    let first = true;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) e.target.classList.add("is-in"), io.unobserve(e.target);
      if (first) (first = false), root.classList.add("reveal");
    });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
  }

  // CSS loops (the lanes, the handoff conversation) run only while visible.
  watch([...document.querySelectorAll("[data-anim]")], (el, on) => el.classList.toggle("is-off", !on));

  // Videos: muted loops with a play/pause button. The person's choice sticks.
  const auto = !reduce && !saveData;
  const wire = (box, video, button) => {
    const label = button.querySelector(".sr-only");
    let wanted = auto;
    let visible = false;
    const sync = () => {
      const playing = !video.paused;
      button.classList.toggle("is-paused", !playing);
      label.textContent = playing ? button.dataset.pause : button.dataset.play;
    };
    const run = () => {
      if (wanted && visible) video.play().catch(() => ((wanted = false), sync()));
      else video.pause();
    };
    video.addEventListener("playing", () => (box.classList.add("is-playing"), sync()));
    video.addEventListener("pause", sync);
    button.addEventListener("click", () => {
      wanted = video.paused;
      if (wanted) visible = true;
      run();
    });
    button.hidden = false;
    sync();
    watch([box], (_, on) => ((visible = on), run()), { rootMargin: "120px 0px" });
  };

  for (const box of document.querySelectorAll("[data-clip]")) {
    const video = box.querySelector("video");
    video.removeAttribute("controls");
    box.classList.add("is-js");
    wire(box, video, box.querySelector(".vid-toggle"));
  }

  // Hero loop: starts after the page has loaded, so it never competes with the first paint.
  const hero = document.querySelector("[data-hero]");
  if (hero) {
    const video = hero.querySelector("video");
    const start = () => {
      video.hidden = false;
      wire(hero, video, hero.querySelector(".vid-toggle"));
    };
    const later = () => ("requestIdleCallback" in window ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 1200));
    if (document.readyState === "complete") later();
    else addEventListener("load", later, { once: true });
  }

  // Performance table: each "now" number counts from its "before" value, once, when it scrolls in.
  if (!reduce) {
    const fmt = (dec) => new Intl.NumberFormat(root.lang, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const cells = [...document.querySelectorAll("[data-count-to]")];
    const table = cells.length ? cells[0].closest("table") : null;
    if (table)
      watch(
        [table],
        (_, on, io) => {
          if (!on) return;
          io.disconnect();
          const t0 = performance.now();
          const items = cells.map((td) => {
            const end = td.textContent;
            return { td, end, from: +td.dataset.countFrom, to: +td.dataset.countTo, f: fmt(+td.dataset.countDec || 0), unit: end.replace(/^[\d.,]+/, "") };
          });
          const step = (t) => {
            const k = Math.min(1, (t - t0) / 1300);
            const e = 1 - Math.pow(1 - k, 3);
            for (const i of items) i.td.textContent = k < 1 ? i.f.format(i.from + (i.to - i.from) * e) + i.unit : i.end;
            if (k < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        },
        { threshold: 0.35 },
      );
  }

  const form = document.querySelector("form.wl");
  if (form) {
    const button = form.querySelector("button[type=submit]");
    const label = button ? button.textContent : "";
    const show = (code) => {
      for (const el of form.querySelectorAll(".wl-msg")) el.classList.toggle("is-shown", el.id === `waitlist-${code}`);
      const shown = form.querySelector(`#waitlist-${code}`);
      if (shown) shown.focus({ preventScroll: true });
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      if (button) {
        button.disabled = true;
        button.textContent = form.dataset.sending || label;
      }
      let code = "failed";
      try {
        const res = await fetch(form.action, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(data),
        });
        const body = await res.json().catch(() => ({}));
        code = typeof body.code === "string" ? body.code : res.ok ? "ok" : "failed";
      } catch {
        code = "failed";
      }
      show(code);
      if (code === "ok") form.reset();
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  const copy = document.querySelector("[data-copy]");
  if (copy && navigator.clipboard) {
    copy.hidden = false;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy || "");
        const original = copy.textContent;
        copy.textContent = copy.dataset.copied || original;
        setTimeout(() => (copy.textContent = original), 1800);
      } catch {
        /* clipboard blocked: the key is still visible to select by hand */
      }
    });
  }
})();
