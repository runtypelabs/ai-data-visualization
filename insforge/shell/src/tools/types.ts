export interface RegisterableModelContext {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      annotations?: Record<string, unknown>;
      execute: (
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => unknown;
    },
    options?: { signal?: AbortSignal },
  ): unknown;
}
