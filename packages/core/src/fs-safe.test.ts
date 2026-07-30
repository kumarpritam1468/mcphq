import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigError } from "./config.js";
import {
  BACKUP_SUFFIX,
  backupFile,
  readJsonFile,
  writeJsonFileSafe,
  writeTextFileSafe,
} from "./fs-safe.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-fssafe-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readJsonFile", () => {
  test("returns undefined for a missing file", () => {
    expect(readJsonFile(path.join(tmp, "nope.json"))).toBeUndefined();
  });

  test("throws a readable ConfigError on broken JSON instead of recovering", () => {
    const file = path.join(tmp, "broken.json");
    fs.writeFileSync(file, "{ nope");
    expect(() => readJsonFile(file)).toThrow(ConfigError);
    expect(() => readJsonFile(file)).toThrow(/will not touch it/);
  });
});

describe("writeJsonFileSafe", () => {
  test("creates a new file (and parent dirs) with no backup", () => {
    const file = path.join(tmp, "a", "b", "new.json");
    const backup = writeJsonFileSafe(file, { hello: 1 });
    expect(backup).toBeNull();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ hello: 1 });
  });

  test("backs up the previous content before overwriting", () => {
    const file = path.join(tmp, "data.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1 }));
    const backup = writeJsonFileSafe(file, { version: 2 });
    expect(backup).toBe(file + BACKUP_SUFFIX);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 2 });
    expect(JSON.parse(fs.readFileSync(backup as string, "utf8"))).toEqual({
      version: 1,
    });
  });

  test("leaves no temp files behind", () => {
    const file = path.join(tmp, "data.json");
    writeJsonFileSafe(file, { ok: true });
    expect(fs.readdirSync(tmp)).toEqual(["data.json"]);
  });
});

describe("writeTextFileSafe", () => {
  test("validation failure leaves the original file untouched", () => {
    const file = path.join(tmp, "config.toml");
    fs.writeFileSync(file, 'model = "original"\n');

    expect(() =>
      writeTextFileSafe(file, "invalid", () => {
        throw new Error("invalid TOML");
      }),
    ).toThrow(ConfigError);
    expect(fs.readFileSync(file, "utf8")).toBe('model = "original"\n');
    expect(fs.existsSync(`${file}${BACKUP_SUFFIX}`)).toBe(true);
  });
});

describe("backupFile", () => {
  test("returns null when there is nothing to back up", () => {
    expect(backupFile(path.join(tmp, "missing.json"))).toBeNull();
  });
});
