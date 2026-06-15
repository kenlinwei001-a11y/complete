import type { AppConfig } from "../config.js";
import { createMemoryRepos } from "./memory.js";
import { createPgRepos } from "./pg.js";
import type { Repos } from "./repos.js";

/** Repository selection: pg when DATABASE_URL is present, otherwise in-memory. */
export async function createRepos(config: AppConfig): Promise<Repos> {
  if (config.DATABASE_URL) return createPgRepos(config.DATABASE_URL);
  return createMemoryRepos();
}

export type { Repos } from "./repos.js";
