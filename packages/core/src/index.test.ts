import { describe, expect, test } from "bun:test";
import { CORE_NAME } from "./index";

describe("core", () => {
  test("exports the package name", () => {
    expect(CORE_NAME).toBe("mcphq");
  });
});
