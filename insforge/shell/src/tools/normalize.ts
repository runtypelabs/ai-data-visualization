import type { Row } from "../types";

export const MAX_CHART_ROWS = 500;

// Some models (seen with nemotron) emit object values as pre-quoted JSON
// strings, e.g. {"x": "\"site_code\""}; unwrap one quote layer.
export const unquote = (value: string): string => {
  const trimmed = value.trim();
  const match = /^"(.*)"$/.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
};

export const normalizeEncodings = (value: unknown): Record<string, { field: string }> => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("encodings must be an object mapping channels to fields.");
  }
  const normalized: Record<string, { field: string }> = {};
  for (const [channel, rawEncoding] of Object.entries(value)) {
    const encoding = rawEncoding as string | { field?: string };
    const field = typeof encoding === "string" ? encoding : encoding?.field;
    if (typeof field !== "string" || !field.trim()) {
      throw new Error(`Encoding "${channel}" needs a field name.`);
    }
    normalized[channel] = { field: unquote(field) };
  }
  return normalized;
};

export const normalizeSemanticTypes = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("semanticTypes must be an object mapping fields to Flint semantic types.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([field, type]) => {
      if (typeof type !== "string" || !type.trim()) {
        throw new Error(`Semantic type for "${field}" must be a string.`);
      }
      return [unquote(field), unquote(type)];
    }),
  );
};

export const normalizeRows = (value: unknown): Row[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "rows must be a non-empty array of result objects (pass through the rows returned by insforge_run_sql).",
    );
  }
  const rows = value.slice(0, MAX_CHART_ROWS);
  for (const row of rows) {
    if (typeof row !== "object" || row == null || Array.isArray(row)) {
      throw new Error("Every row must be a flat object of column values.");
    }
  }
  return rows as Row[];
};
