import { afterEach, describe, expect, test } from "bun:test";
import { isPlain } from "./index.js";

const originalEnv = { ...process.env };
const originalArgv = [...process.argv];
const originalIsTTY = process.stdout.isTTY;

function reset(): void {
  process.env = { ...originalEnv };
  process.argv = [...originalArgv];
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  });
}

afterEach(reset);

describe("isPlain", () => {
  test("true when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    expect(isPlain()).toBe(true);
  });

  test("true when NO_COLOR is set, regardless of value", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    process.env.NO_COLOR = "";
    expect(isPlain()).toBe(true);
  });

  test("true when TERM=dumb", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.NO_COLOR;
    process.env.TERM = "dumb";
    expect(isPlain()).toBe(true);
  });

  test("true when --no-color is passed", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm";
    process.argv = [...process.argv, "--no-color"];
    expect(isPlain()).toBe(true);
  });

  test("false on a plain interactive TTY with no overrides", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm";
    expect(isPlain()).toBe(false);
  });
});
