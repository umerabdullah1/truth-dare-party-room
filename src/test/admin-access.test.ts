import { describe, expect, it } from "vitest";

import { isConfiguredAdmin } from "@/lib/admin-access";

describe("private admin access", () => {
  it("allows only the configured Gmail address", () => {
    expect(isConfiguredAdmin("u96598999@gmail.com")).toBe(true);
    expect(isConfiguredAdmin("friend@gmail.com")).toBe(false);
    expect(isConfiguredAdmin(null)).toBe(false);
  });
});