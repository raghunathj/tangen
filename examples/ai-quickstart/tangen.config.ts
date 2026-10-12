import type { TangenConfig } from "@tangen/cms";
import schema from "./content-objects";

/**
 * Minimal Tangen project config for the ai-quickstart example. The development
 * environment targets whatever DATABASE_URL(_DEVELOPMENT) points at — e.g. a
 * throwaway database — so `tangen check` / `push` run in isolation.
 */
const config: TangenConfig = {
  project: "ai-quickstart",
  workspaceId: "wsp_ai_quickstart",
  schema: "./content-objects/index.ts",
  schemas: schema.types,
  databases: {
    development: {
      url: process.env.DATABASE_URL_DEVELOPMENT ?? process.env.DATABASE_URL ?? "",
    },
  },
  environments: {
    development: { database: "development" },
  },
};

export default config;
