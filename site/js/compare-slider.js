(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-compare]").forEach((viewport) => {
    const input = viewport.querySelector("[data-compare-input]");
    if (!input) return;
    let touched = false;

    const set = (pos) => {
      const old = Math.round(pos);
      viewport.style.setProperty("--pos", String(pos));
      input.value = String(old);
      input.setAttribute(
        "aria-valuetext",
        old === 0
          ? "New site only"
          : old === 100
            ? "Old site only"
            : `${old}% old site, ${100 - old}% new site`,
      );
    };

    const stop = () => (touched = true);
    input.addEventListener("pointerdown", stop);
    input.addEventListener("keydown", stop);
    input.addEventListener("focus", stop);
    input.addEventListener("input", () => {
      touched = true;
      set(Number(input.value));
    });

    const pause = 4000;
    let sweeping = false;
    let visible = false;
    let timer;

    const sweep = () => {
      if (sweeping) return;
      sweeping = true;
      const stops = [50, 82, 18, 50];
      const leg = 1100;
      const start = performance.now();
      const step = (now) => {
        if (touched) {
          sweeping = false;
          return;
        }
        const t = (now - start) / leg;
        const i = Math.floor(t);
        if (i >= stops.length - 1) {
          set(50);
          sweeping = false;
          return schedule(pause);
        }
        const k = t - i;
        const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        set(stops[i] + (stops[i + 1] - stops[i]) * eased);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const schedule = (delay) => {
      clearTimeout(timer);
      if (touched || !visible || sweeping) return;
      timer = window.setTimeout(() => {
        if (!touched && visible) sweep();
      }, delay);
    };

    if (!reduceMotion) {
      new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (visible) schedule(400);
          else clearTimeout(timer);
        },
        { threshold: 0.6 },
      ).observe(viewport);
    }
  });
})();
