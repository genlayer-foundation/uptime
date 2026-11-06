// Each network deploys the canary build for ITS GenVM (contracts/targets.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANARY_SOURCE, CANARY_SOURCES } from "@/lib/heartbeat/canary";

const targets = JSON.parse(readFileSync(new URL("../../contracts/targets.json", import.meta.url), "utf8")).targets;

describe("per-network contract builds", () => {
  it("pins each network's runner in its canary", () => {
    for (const n of ["studio", "bradbury"] as const) {
      expect(CANARY_SOURCES[n].split("\n")[0]).toBe(`# { "Seq": [{"Depends": "${targets[n].runner}"}] }`);
    }
  });
  it("speaks each SDK's dialect", () => {
    expect(CANARY_SOURCES.studio).toContain("from genlayer import *");
    expect(CANARY_SOURCES.bradbury).toContain("import genlayer as gl\n");
    expect(CANARY_SOURCE).toBe(CANARY_SOURCES.bradbury); // the Heartbeat runs on Bradbury
  });
});
