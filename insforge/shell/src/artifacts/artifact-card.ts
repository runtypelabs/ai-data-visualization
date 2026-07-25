import type { AgentWidgetConfig } from "@runtypelabs/persona";

import { createTextElement } from "../dom";

export const renderArtifactCard: NonNullable<
  NonNullable<NonNullable<AgentWidgetConfig["features"]>["artifacts"]>["renderCard"]
> = ({ artifact }) => {
  const card = document.createElement("div");
  card.className = "ayb-artifact-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("data-open-artifact", artifact.artifactId);
  card.setAttribute("aria-label", `Open ${artifact.title}`);
  card.appendChild(createTextElement("div", "ayb-artifact-card-icon", "✦"));
  const copy = document.createElement("div");
  copy.className = "ayb-artifact-card-copy";
  copy.append(
    createTextElement("strong", "", artifact.title || "Generated analysis"),
    createTextElement("span", "", "Interactive analysis · Open"),
  );
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 20 20");
  arrow.innerHTML = '<path d="m7 4 6 6-6 6"/>';
  card.append(copy, arrow);
  return card;
};
