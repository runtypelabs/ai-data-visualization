export interface RegisterableModelContext {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      annotations?: Record<string, unknown>;
      execute: (args: Record<string, unknown>) => unknown;
    },
    options?: { signal?: AbortSignal },
  ): void;
}
