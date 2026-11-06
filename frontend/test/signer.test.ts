import { describe, expect, it } from "vitest";
import { signingKey } from "@/lib/signer";

// Dummy values only: never real keys.
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const C = "0x" + "c".repeat(64);

describe("signingKey", () => {
  it("bradbury uses RELAYER_KEY_BRADBURY, trimmed", () => {
    expect(signingKey("bradbury", { RELAYER_KEY_BRADBURY: ` ${A} ` })).toBe(A);
  });

  it("bradbury ignores the removed legacy PRIVATE_KEY", () => {
    expect(signingKey("bradbury", { PRIVATE_KEY: B })).toBeNull();
    expect(signingKey("bradbury", { RELAYER_KEY_BRADBURY: "  ", PRIVATE_KEY: B })).toBeNull();
  });

  it("studio uses only RELAYER_KEY_STUDIO", () => {
    expect(signingKey("studio", { RELAYER_KEY_STUDIO: C, RELAYER_KEY_BRADBURY: A })).toBe(C);
    expect(signingKey("studio", { RELAYER_KEY_BRADBURY: A })).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(signingKey("bradbury", {})).toBeNull();
    expect(signingKey("studio", {})).toBeNull();
  });
});
