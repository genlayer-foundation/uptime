// Self-serve limit validation: what an owner may save for a job and an address.
import { describe, expect, it } from "vitest";
import { defaultRuleSettings, LIMITS, validateRecipientCap, validateRuleSettings } from "@/lib/mailer/limits";

const valid = { enabled: true, recipientIds: [1] };

describe("defaults (owner decision 2026-11-02)", () => {
  it("10 alerts/job/day, 15 min cooldown, 20/recipient/day, alerts off until saved", () => {
    expect(LIMITS.perJobPerDay).toEqual({ default: 10, min: 1, max: 50 });
    expect(LIMITS.cooldownMin).toEqual({ default: 15, min: 5, max: 120 });
    expect(LIMITS.perRecipientPerDay.default).toBe(20);
    expect(defaultRuleSettings()).toMatchObject({ enabled: false, perJobPerDay: 10, cooldownMin: 15, failAfter: 1, onFailure: true, onAssertion: true, onRecovery: true, digest: false });
  });

  it("missing fields take the defaults", () => {
    const r = validateRuleSettings(valid);
    expect(r.ok && r.value).toMatchObject({ enabled: true, perJobPerDay: 10, cooldownMin: 15, recipientIds: [1] });
  });
});

describe("validateRuleSettings", () => {
  it.each([
    ["perJobPerDay", 1, true],
    ["perJobPerDay", 50, true],
    ["perJobPerDay", 0, false],
    ["perJobPerDay", 51, false],
    ["perJobPerDay", 2.5, false],
    ["perJobPerDay", "12", true],
    ["perJobPerDay", "ten", false],
    ["cooldownMin", 5, true],
    ["cooldownMin", 120, true],
    ["cooldownMin", 4, false],
    ["cooldownMin", 121, false],
    ["failAfter", 100, true],
    ["failAfter", 0, false],
  ] as const)("%s = %s -> ok %s", (field, value, ok) => {
    const r = validateRuleSettings({ ...valid, [field]: value });
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.errors[field]).toMatch(/whole number from \d+ to \d+/);
  });

  it("never clamps: an out-of-range value is an error, not a silently different limit", () => {
    const r = validateRuleSettings({ ...valid, perJobPerDay: 500 });
    expect(r.ok).toBe(false);
  });

  it("an enabled rule needs a recipient and a trigger", () => {
    const a = validateRuleSettings({ enabled: true, recipientIds: [] });
    expect(!a.ok && a.errors.recipientIds).toBeTruthy();
    const b = validateRuleSettings({ ...valid, onFailure: false, onAssertion: false, onRecovery: false, digest: false });
    expect(!b.ok && b.errors.onFailure).toBeTruthy();
  });

  it("a disabled rule may be empty", () => {
    expect(validateRuleSettings({ enabled: false, recipientIds: [] }).ok).toBe(true);
  });

  it("rejects more than 3 recipients, bad ids and non-boolean switches", () => {
    expect(validateRuleSettings({ ...valid, recipientIds: [1, 2, 3, 4] }).ok).toBe(false);
    expect(validateRuleSettings({ ...valid, recipientIds: [-1] }).ok).toBe(false);
    expect(validateRuleSettings({ ...valid, recipientIds: "1" }).ok).toBe(false);
    expect(validateRuleSettings({ ...valid, digest: "yes" }).ok).toBe(false);
  });

  it("dedupes recipient ids", () => {
    const r = validateRuleSettings({ ...valid, recipientIds: [2, 2, "2"] });
    expect(r.ok && r.value.recipientIds).toEqual([2]);
  });
});

describe("validateRecipientCap", () => {
  it("1-100 or null for the default", () => {
    expect(validateRecipientCap(1)).toEqual({ ok: true, value: 1 });
    expect(validateRecipientCap(100)).toEqual({ ok: true, value: 100 });
    expect(validateRecipientCap(null)).toEqual({ ok: true, value: null });
    expect(validateRecipientCap(0).ok).toBe(false);
    expect(validateRecipientCap(101).ok).toBe(false);
    expect(validateRecipientCap(undefined).ok).toBe(false);
  });
});
