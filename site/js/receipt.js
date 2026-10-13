const paper = document.querySelector("[data-receipt]");
const reprint = document.querySelector("[data-reprint]");

if (paper && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const print = () => {
    paper.classList.remove("printing");
    void paper.offsetWidth;
    paper.classList.add("printing");
  };

  paper.classList.add("waiting");
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    paper.classList.remove("waiting");
    print();
  });
  observer.observe(document.querySelector(".printer") ?? paper);

  if (reprint) {
    reprint.hidden = false;
    reprint.addEventListener("click", print);
  }
}
