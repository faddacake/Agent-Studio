import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackup } from "./backup.js";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database.Database | null = null;

export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getDbPath(): string {
  return path.join(getDataDir(), "db", "agentstudio.db");
}

export function getDb() {
  if (_db) return _db;

  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);

  // Ensure directory exists
  fs.mkdirSync(dbDir, { recursive: true });

  // Pre-migration backup (only if DB already exists)
  createBackup(dbPath);

  // Open SQLite with WAL mode
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("wal_autocheckpoint = 1000"); // Auto-checkpoint every 1000 pages

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });

  // Run migrations — fail-and-exit on error
  const migrationsCandidates = [
    path.join(__dirname, "migrations"),                        // dist/migrations (production)
    path.join(__dirname, "..", "src", "migrations"),            // ../src/migrations (from dist)
    path.resolve("packages/db/src/migrations"),                // from monorepo root (dev/webpack)
    path.resolve("packages/db/dist/migrations"),               // from monorepo root (production)
  ];


const migrationsDir = migrationsCandidates.find((p) => fs.existsSync(p));

if (migrationsDir) {
  try {
    migrate(_db, { migrationsFolder: migrationsDir });
    console.log(`[db] Migrations applied successfully from: ${migrationsDir}`);
  } catch (err) {
    console.error("[db] Migration failed — exiting. Restore from backup if needed.");
    console.error(err);
    process.exit(1);
  }
} else {
  console.log("[db] No migrations directory found, skipping migrations");
}
  return _db;
}

/** Run a safety WAL checkpoint (call on graceful shutdown) */
export function checkpoint(): void {
  if (_sqlite) {
    _sqlite.pragma("wal_checkpoint(TRUNCATE)");
    console.log("[db] WAL checkpoint completed");
  }
}

/** Close the database connection */
export function closeDb(): void {
  if (_sqlite) {
    checkpoint();
    _sqlite.close();
    _sqlite = null;
    _db = null;
    console.log("[db] Database closed");
  }
}

import { sql } from "drizzle-orm";

// ...

export function dbHealthCheck(): void {
  const db = getDb();
  db.get(sql`SELECT 1 as result`);
}

export { sql } from "drizzle-orm";

export { schema };

export { resolveProviderKey } from "./resolveProviderKey.js";

