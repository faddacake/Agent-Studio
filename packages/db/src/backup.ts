import fs from "node:fs";
import path from "node:path";

const MAX_BACKUPS = 3;

export function createBackup(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const dir = path.dirname(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const backupPath = path.join(dir, `agentstudio.db.bak.${timestamp}`);

  fs.copyFileSync(dbPath, backupPath);
  console.log(`[db] Backup created: ${backupPath}`);

  // Prune old backups, keep only MAX_BACKUPS most recent
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("agentstudio.db.bak."))
    .sort()
    .reverse();

  for (const old of backups.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(dir, old));
    console.log(`[db] Pruned old backup: ${old}`);
  }

  return backupPath;
}
