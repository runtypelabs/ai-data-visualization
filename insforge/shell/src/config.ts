/**
 * Runtime page config, injected by the serving InsForge function as
 * `window.__AYB_CONFIG__` so one prebuilt bundle works for any project.
 * apiUrl + clientToken + insforgeBaseUrl are required; the rest is optional.
 */
export interface AybPageConfig {
  apiUrl?: string;
  clientToken?: string;
  insforgeBaseUrl?: string;
  /** InsForge anon (publishable) key — enables end-user sign-in when present. */
  insforgeAnonKey?: string;
  productName?: string;
  starterPrompts?: string[];
  /** Set false when the connected database is real customer data. */
  sampleDataset?: boolean;
  /** Demo logins surfaced as one-click fills on the sign-in card. */
  demoAccounts?: Array<{ email: string; password: string; label?: string }>;
}

const PAGE_CONFIG: AybPageConfig =
  (window as Window & { __AYB_CONFIG__?: AybPageConfig }).__AYB_CONFIG__ ?? {};

export const API_URL = PAGE_CONFIG.apiUrl ?? "https://api.runtype.com";
export const CLIENT_TOKEN = PAGE_CONFIG.clientToken ?? "";
export const INSFORGE_BASE = PAGE_CONFIG.insforgeBaseUrl ?? "";
export const INSFORGE_ANON_KEY = PAGE_CONFIG.insforgeAnonKey ?? "";
export const PRODUCT_NAME = PAGE_CONFIG.productName ?? "Generative Dashboard Template";
export const IS_SAMPLE_DATASET = PAGE_CONFIG.sampleDataset !== false;
export const DEMO_ACCOUNTS = PAGE_CONFIG.demoAccounts ?? [];

// Each default pill is phrased to imply a period AND a breakdown, so the
// analyst's own SQL returns a multi-series result rather than one aggregate row
// per site — and to make an expressive Flint chart the natural fit rather than a
// four-bar bar chart. In order these lean toward a multi-series line or bump
// chart, a bullet chart against pace, a waterfall of margin variance, and the
// email/reminder workflow.
export const STARTER_PROMPTS = PAGE_CONFIG.starterPrompts ?? [
  "How has each site tracked against target over the last 12 weeks — who's gaining and who's slipping?",
  "Which sites are behind pace right now, and how did they get there day by day?",
  "Where are we losing margin, and which sites and jobs account for the gap?",
  "Email each site owner their biggest issue, and alert me if it gets worse.",
];
