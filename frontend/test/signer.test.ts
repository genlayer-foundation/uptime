import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSignerWarning, signingKey } from "@/lib/signer";

// Dummy values only: never real keys.
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const C = "0x" + "c".repeat(64);

afterEach(() => {
  resetSignerWarning();
  vi.restoreAllMocks();
});

describe("signingKey", () => {
  it("bradbury prefers RELAYER_KEY_BRADBURY over PRIVATE_KEY, without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(signingKey("bradbury", { RELAYER_KEY_BRADBURY: A, PRIVATE_KEY: B })).toBe(A);
    expect(warn).not.toHaveBeenCalled();
  });

  it("bradbury falls back to PRIVATE_KEY and warns once, without the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(signingKey("bradbury", { RELAYER_KEY_BRADBURY: "  ", PRIVATE_KEY: ` ${B} ` })).toBe(B);
    expect(signingKey("bradbury", { PRIVATE_KEY: B })).toBe(B);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(B);
  });

  it("studio uses only RELAYER_KEY_STUDIO", () => {
    expect(signingKey("studio", { RELAYER_KEY_STUDIO: C, RELAYER_KEY_BRADBURY: A, PRIVATE_KEY: B })).toBe(C);
    expect(signingKey("studio", { RELAYER_KEY_BRADBURY: A, PRIVATE_KEY: B })).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(signingKey("bradbury", {})).toBeNull();
  });
});
