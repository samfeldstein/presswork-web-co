const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const DURATION = 300;

const animations = new Map();
const items = [...document.querySelectorAll(".faq details")];

const isOpen = (details) => details.open && !("closing" in details.dataset);

const stop = (details) => {
  const running = animations.get(details);
  if (!running) return;
  running.onfinish = null;
  running.cancel();
  animations.delete(details);
  details.style.overflow = "";
};

const run = (details, from, to, done) => {
  stop(details);
  details.style.overflow = "hidden";
  const animation = details.animate(
    { blockSize: [`${from}px`, `${to}px`] },
    { duration: DURATION, easing: "ease" },
  );
  animations.set(details, animation);
  animation.onfinish = () => {
    animations.delete(details);
    details.style.overflow = "";
    done();
  };
};

const closedHeight = (details) => {
  const style = getComputedStyle(details);
  return (
    details.querySelector("summary").getBoundingClientRect().height +
    parseFloat(style.borderBlockStartWidth) +
    parseFloat(style.borderBlockEndWidth)
  );
};

const open = (details) => {
  delete details.dataset.closing;
  const start = details.getBoundingClientRect().height;
  stop(details);
  details.open = true;
  if (!reduceMotion.matches) {
    run(details, start, details.getBoundingClientRect().height, () => {});
  }
};

const close = (details) => {
  if (reduceMotion.matches) {
    stop(details);
    delete details.dataset.closing;
    details.open = false;
    return;
  }
  details.dataset.closing = "";
  run(
    details,
    details.getBoundingClientRect().height,
    closedHeight(details),
    () => {
      details.open = false;
      delete details.dataset.closing;
    },
  );
};

const closeOthers = (details) => {
  items.filter((other) => other !== details && isOpen(other)).forEach(close);
};

items.forEach((details) => {
  details.removeAttribute("name");
  details.addEventListener("toggle", () => {
    if (isOpen(details)) closeOthers(details);
  });
  details.querySelector("summary").addEventListener("click", (event) => {
    event.preventDefault();
    if (isOpen(details)) {
      close(details);
    } else {
      closeOthers(details);
      open(details);
    }
  });
});
