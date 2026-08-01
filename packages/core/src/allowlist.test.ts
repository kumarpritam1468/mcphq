import { describe, expect, test } from "bun:test";
import { isAllowlisted } from "./allowlist.js";

describe("isAllowlisted", () => {
  test("trusted org prefix matches", () => {
    expect(
      isAllowlisted("https://github.com/modelcontextprotocol/servers"),
    ).toBe(true);
  });

  test("unknown org does not match", () => {
    expect(isAllowlisted("https://github.com/randomuser/sketchy-mcp")).toBe(
      false,
    );
  });

  test("a similarly-named but different org is not a prefix match false positive", () => {
    expect(
      isAllowlisted("https://github.com/modelcontextprotocol-evil/servers"),
    ).toBe(false);
  });

  test("missing repository url is untrusted", () => {
    expect(isAllowlisted(undefined)).toBe(false);
  });
});
