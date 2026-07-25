import { registerFlintChartComponent } from "./flint-chart";
import { registerOnboardingComponent } from "./onboarding";

export { renderArtifactCard } from "./artifact-card";
export { showOnboardingArtifact } from "./onboarding";
export { FLINT_COMPONENT } from "./flint-chart";

/** Register Persona component renderers used by this shell. */
export const registerArtifactComponents = (): void => {
  registerFlintChartComponent();
  registerOnboardingComponent();
};
