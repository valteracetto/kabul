// Progressive enhancement only: the page works without this file.
// - Waitlist: send the form with fetch and show the answer in place (without JS the browser posts the
//   form and the function redirects back to #waitlist-<code>, which CSS shows with :target).
// - Pix: copy the key to the clipboard.
(() => {
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
