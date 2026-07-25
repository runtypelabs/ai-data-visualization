import { resolve } from "node:path";

import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, resolve(__dirname, ".."), "");
  const localRuntimeConfig = {
    apiUrl: env.RUNTYPE_API_URL || "https://api.runtype.com",
    clientToken: env.RUNTYPE_CLIENT_TOKEN || "",
    insforgeBaseUrl: env.INSFORGE_BASE_URL || env.NEXT_PUBLIC_INSFORGE_URL || "",
    ...(env.INSFORGE_ANON_KEY || env.NEXT_PUBLIC_INSFORGE_ANON_KEY
      ? { insforgeAnonKey: env.INSFORGE_ANON_KEY || env.NEXT_PUBLIC_INSFORGE_ANON_KEY }
      : {}),
  };

  return {
    plugins: [
      ...(command === "serve"
        ? [
            {
              name: "ayb-local-runtime-config",
              transformIndexHtml(html: string) {
                const serializedConfig = JSON.stringify(localRuntimeConfig).replace(
                  /</g,
                  "\\u003c",
                );
                return html.replace(
                  "<head>",
                  `<head>\n    <script>window.__AYB_CONFIG__ = ${serializedConfig};</script>`,
                );
              },
            },
          ]
        : []),
      viteSingleFile(),
    ],
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 8000,
    },
  };
});
