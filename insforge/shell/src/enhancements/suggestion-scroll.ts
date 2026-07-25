export const installSuggestionScrollAffordance = (mount: HTMLElement): void => {
  if (mount.dataset.aybSuggestionScrollInstalled === "true") return;
  mount.dataset.aybSuggestionScrollInstalled = "true";

  const updateRow = (row: HTMLElement): void => {
    const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);
    const overflows = maxScrollLeft > 2;
    row.classList.toggle("ayb-suggestions-overflow", overflows);
    row.classList.toggle("ayb-suggestions-can-scroll-left", overflows && row.scrollLeft > 2);
    row.classList.toggle(
      "ayb-suggestions-can-scroll-right",
      overflows && row.scrollLeft < maxScrollLeft - 2,
    );
    if (overflows) {
      row.tabIndex = 0;
      row.setAttribute("aria-label", "Suggested questions. Scroll horizontally for more.");
    } else {
      row.removeAttribute("tabindex");
      row.removeAttribute("aria-label");
    }
  };

  const updateAll = (): void => {
    for (const row of mount.querySelectorAll<HTMLElement>(
      "[data-persona-composer-suggestions]",
    )) {
      updateRow(row);
    }
  };

  mount.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches("[data-persona-composer-suggestions]")
      ) {
        updateRow(target);
      }
    },
    { capture: true, passive: true },
  );

  const mutationObserver = new MutationObserver(() => {
    window.requestAnimationFrame(updateAll);
  });
  mutationObserver.observe(mount, { childList: true, subtree: true });

  const resizeObserver = new ResizeObserver(updateAll);
  resizeObserver.observe(mount);
  window.requestAnimationFrame(updateAll);
};
