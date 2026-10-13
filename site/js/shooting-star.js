const star = document.querySelector("[data-star]");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const between = (min, max) => min + Math.random() * (max - min);

const fly = () => {
  if (!star || reduceMotion.matches || document.hidden) return;
  const x = between(0.05, 0.6) * innerWidth;
  const y = between(0.05, 0.4) * innerHeight;
  const angle = between(15, 35);
  const distance = between(0.2, 0.35) * innerWidth;
  const at = (travel, stretch) =>
    `translate(${x}px, ${y}px) rotate(${angle}deg) translateX(${travel}px) scaleX(${stretch})`;
  star.animate(
    [
      { transform: at(0, 0.2), opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: at(distance, 1), opacity: 0 },
    ],
    { duration: between(700, 1100), easing: "ease-in" },
  );
};

const next = () => setTimeout(() => (fly(), next()), between(7000, 18000));
if (star) setTimeout(() => (fly(), next()), between(2500, 5000));
