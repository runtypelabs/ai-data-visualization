export const createTextElement = (
  tag: keyof HTMLElementTagNameMap,
  className: string,
  text: string,
): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
