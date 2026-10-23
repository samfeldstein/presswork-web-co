const headline = document.querySelector("[data-headline]");
const word = document.querySelector("[data-word]");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (headline && word && !reduceMotion.matches) {
  const words = (headline.dataset.words ?? "").split("|").filter(Boolean);
  const shown = () =>
    document.hidden
      ? new Promise((resume) => {
          const onChange = () => {
            if (document.hidden) return;
            document.removeEventListener("visibilitychange", onChange);
            resume();
          };
          document.addEventListener("visibilitychange", onChange);
        })
      : Promise.resolve();
  const wait = async (ms) => {
    await shown();
    await new Promise((done) => setTimeout(done, ms));
  };
  const show = (text) => (word.textContent = text);
  const typing = (on) => headline.toggleAttribute("data-typing", on);

  const loop = async () => {
    await wait(6000);
    const cycle = [...words, ""];
    for (let i = 0; ; i = (i + 1) % cycle.length) {
      if (reduceMotion.matches) return show("");
      const letters = Array.from(cycle[i]);
      if (letters.length) {
        typing(true);
        for (let n = 1; n <= letters.length; n++) {
          show(letters.slice(0, n).join(""));
          await wait(70 + Math.random() * 50);
        }
        typing(false);
        await wait(2400);
        typing(true);
        for (let n = letters.length - 1; n >= 0; n--) {
          show(letters.slice(0, n).join(""));
          await wait(38);
        }
        typing(false);
        await wait(450);
      } else {
        await wait(2600);
      }
    }
  };

  loop();
}
