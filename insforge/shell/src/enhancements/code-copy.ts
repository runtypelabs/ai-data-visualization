import { createTextElement } from "../dom";

export const installCodeBlockCopyButtons = (mount: HTMLElement): void => {
  if (mount.dataset.aybCodeCopyInstalled === "true") return;
  mount.dataset.aybCodeCopyInstalled = "true";

  const enhanceCodeBlocks = (): void => {
    const codeBlocks = mount.querySelectorAll<HTMLElement>(
      [
        ".persona-artifact-pane .persona-markdown-bubble pre",
        ".persona-message-assistant-bubble pre",
      ].join(","),
    );
    for (const block of codeBlocks) {
      if (block.dataset.aybCopyReady === "true") continue;
      block.dataset.aybCopyReady = "true";
      block.classList.add("ayb-copyable-code");

      const button = createTextElement("button", "ayb-code-copy", "Copy") as HTMLButtonElement;
      button.type = "button";
      button.title = "Copy code";
      button.setAttribute("aria-label", "Copy code");
      button.setAttribute("aria-live", "polite");
      block.prepend(button);
    }
  };

  mount.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".ayb-code-copy");
    if (!button || !mount.contains(button) || button.disabled) return;
    const block = button.closest("pre");
    const code = block?.querySelector("code")?.textContent;
    if (!code) return;

    button.disabled = true;
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        button.textContent = "Copied";
        button.dataset.state = "success";
      })
      .catch(() => {
        button.textContent = "Copy failed";
        button.dataset.state = "error";
      })
      .finally(() => {
        window.setTimeout(() => {
          button.textContent = "Copy";
          delete button.dataset.state;
          button.disabled = false;
        }, 1500);
      });
  });

  const observer = new MutationObserver(enhanceCodeBlocks);
  observer.observe(mount, { childList: true, subtree: true });
  enhanceCodeBlocks();
};
