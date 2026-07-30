import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigError } from "./config.js";

/**
 * Safe file operations for the one unforgivable failure mode: corrupting a
 * user's client config. Every write goes through here.
 *
 * Rules (non-negotiable, see KNOWLEDGE.md):
 * 1. Backup before write.
 * 2. Atomic write: temp file in the same directory, validate, rename.
 * 3. Callers merge into existing data — this module never decides content.
 */

export const BACKUP_SUFFIX = ".mcphq-backup";

/**
 * Read and parse a JSON file. Returns undefined when the file does not
 * exist; throws a readable ConfigError when it exists but is unparseable
 * (we must never "recover" from a parse failure by overwriting the file).
 */
export function readJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(
      filePath,
      `Could not read ${filePath}: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      filePath,
      `${filePath} contains invalid JSON and mcphq will not touch it.\n  ${(err as Error).message}\nFix or remove the file, then re-run.`,
    );
  }
}

/** Copy the current file to a rolling `<file>.mcphq-backup`. Returns the backup path, or null if there was nothing to back up. */
export function backupFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = filePath + BACKUP_SUFFIX;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Atomically replace `filePath` with `data` serialized as pretty JSON:
 * backup → write temp file → parse it back (validate) → rename over the
 * original. Returns the backup path (null when the file is new).
 */
export function writeJsonFileSafe(
  filePath: string,
  data: unknown,
): string | null {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  return writeTextFileSafe(filePath, serialized, (raw) => {
    JSON.parse(raw);
  });
}

/**
 * Atomically replace a structured text file after validating the bytes written
 * to the temporary file. JSON and TOML adapters share this safety boundary.
 */
export function writeTextFileSafe(
  filePath: string,
  content: string,
  validate: (content: string) => void,
): string | null {
  const backupPath = backupFile(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.mcphq-tmp-${process.pid}`,
  );
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    validate(fs.readFileSync(tempPath, "utf8"));
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // best-effort cleanup; the original file is untouched either way
    }
    throw new ConfigError(
      filePath,
      `Failed to write ${filePath}: ${(err as Error).message}\nThe original file was not modified${backupPath ? ` (backup at ${backupPath})` : ""}.`,
    );
  }
  return backupPath;
}
