import { componentRegistry, type ComponentRenderer } from "@runtypelabs/persona";

import { IS_SAMPLE_DATASET, STARTER_PROMPTS } from "../config";
import { createTextElement } from "../dom";
import { getWidget, sendPrompt } from "../widget-session";

const ONBOARDING_COMPONENT = "AybOnboarding";
const SAMPLE_TABLES = [
  "sites",
  "site_managers",
  "jobs",
  "production_targets",
  "production_actuals",
  "materials_usage",
  "safety_events",
  "job_costs",
];

const OnboardingRenderer: ComponentRenderer = () => {
  const root = document.createElement("section");
  root.className = "ayb-artifact ayb-onboard";

  const hero = document.createElement("header");
  hero.className = "ayb-artifact-hero";
  hero.append(
    createTextElement("h2", "", "Ask questions. Watch the SQL. Get a dashboard."),
    createTextElement(
      "p",
      "ayb-artifact-description",
      "This analyst adapts to whatever InsForge Postgres database it is connected to: it discovers the schema, writes auditable SQL, and assembles an interactive chart to match each question. Runtype powers the agent and this interactive chat experience.",
    ),
  );

  const steps = document.createElement("div");
  steps.className = "ayb-onboard-steps";
  const stepDefinitions: Array<[string, string, string]> = [
    [
      "1",
      "Ask in natural language",
      "No dashboards to configure. Ask about performance, risk, or cost the way you would ask a colleague.",
    ],
    [
      "2",
      "Watch it work",
      "The agent scans the live schema and runs real SQL you can inspect on every chart's SQL tab. Nothing is invented.",
    ],
    [
      "3",
      "Act on it",
      "It briefs the right owners and schedules follow-up checks, so an answer becomes a workflow.",
    ],
  ];
  for (const [number, title, body] of stepDefinitions) {
    const card = document.createElement("div");
    card.className = "ayb-onboard-step";
    card.append(
      createTextElement("span", "ayb-onboard-step-number", number),
      createTextElement("strong", "", title),
      createTextElement("p", "", body),
    );
    steps.appendChild(card);
  }

  let sample: HTMLElement | null = null;
  if (IS_SAMPLE_DATASET) {
    sample = document.createElement("div");
    sample.className = "ayb-onboard-sample";
    sample.append(
      createTextElement("span", "ayb-onboard-sample-badge", "Sample data"),
      createTextElement(
        "p",
        "",
        "This demo is wired to a fictional industrial-operations dataset so there is something to explore. Connect your own database and the analyst re-derives everything from your schema; nothing below is hard-coded.",
      ),
    );
    const tables = document.createElement("div");
    tables.className = "ayb-onboard-tables";
    for (const table of SAMPLE_TABLES) {
      tables.appendChild(createTextElement("code", "", table));
    }
    sample.appendChild(tables);
  }

  const tryBlock = document.createElement("div");
  tryBlock.className = "ayb-onboard-try";
  tryBlock.appendChild(createTextElement("strong", "", "Try it"));
  for (const prompt of STARTER_PROMPTS) {
    const button = createTextElement("button", "ayb-onboard-prompt", prompt) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => sendPrompt(prompt));
    tryBlock.appendChild(button);
  }

  root.append(hero, steps);
  if (sample) root.appendChild(sample);
  root.appendChild(tryBlock);
  return root;
};

export const registerOnboardingComponent = (): void => {
  componentRegistry.register(ONBOARDING_COMPONENT, OnboardingRenderer);
};

export const showOnboardingArtifact = (): void => {
  const widget = getWidget();
  if (!widget) return;
  if (widget.getMessages().length > 0 || widget.getArtifacts().length > 0) return;
  widget.upsertArtifact({
    id: "ayb-onboarding",
    artifactType: "component",
    title: "How this works",
    component: ONBOARDING_COMPONENT,
    props: {},
  });
  widget.showArtifacts();
};
