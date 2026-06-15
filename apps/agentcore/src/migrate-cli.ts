import pg from "pg";
import { runMigrations } from "./persistence/pg.js";

/**
 * Idempotent migration runner (`pnpm --filter agentcore migrate`).
 * The server also auto-migrates at boot when DATABASE_URL is set
 * (see createPgRepos); this CLI exists for explicit ops runs.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await runMigrations(pool);
    console.log("[agentcore] migrations applied (idempotent)");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
