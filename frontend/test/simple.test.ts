// The wizard's plain fields edit the real templates' action args.
import { describe, expect, it } from "vitest";
import { draftFromTemplate } from "@/components/jobs/draft";
import { args, expectedAnswer, mainStep, passesWhen, withArg, withExpectedAnswer, linesToArgs, argsToLines } from "@/components/jobs/simple";
import { templates } from "@/lib/jobs/presets";

const tpl = (id: string) => {
  const t = templates("bradbury").find((x) => x.preset === id)!;
  return draftFromTemplate({ name: t.name, preset: t.preset, steps: t.steps, schedule: t.schedule, assertions: t.assertions }, "bradbury");
};
let n = 0;
const uid = () => `t${n++}`;

describe("plain fields", () => {
  it("website: URL, status and text are check_url's args", () => {
    let d = tpl("check-url");
    const s = mainStep("website", d)!;
    expect(s.method).toBe("check_url");
    d = withArg(d, s.id, 2, "https://genlayer.com");
    d = withArg(d, s.id, 3, 200);
    d = withArg(d, s.id, 4, "Sign in");
    expect(args(mainStep("website", d)!).slice(2)).toEqual(["https://genlayer.com", 200, "Sign in"]);
    expect(passesWhen("website", d)).toBe("Passes when validators agree that genlayer.com answers with status 200 and the page contains “Sign in”.");
  });

  it("ai: the expected answer is a normalized rule on the stored answer", () => {
    let d = tpl("ask");
    expect(mainStep("ai", d)).not.toBeNull();
    d = withExpectedAnswer(d, "Yes!", uid);
    expect(expectedAnswer(d)).toBe("yes");
    expect(d.assertions.filter((a) => a.path === "answer")).toHaveLength(1);
    d = withExpectedAnswer(d, "", uid);
    expect(d.assertions.filter((a) => a.path === "answer")).toHaveLength(0);
    expect(passesWhen("ai", d)).toBe("Passes when validators agree on an answer.");
  });

  it("api and deploy-then-call templates have the shape the fields expect", () => {
    expect(mainStep("api", tpl("check-api"))).not.toBeNull();
    expect(mainStep("deploy-call", tpl("deploy-then-call"))).not.toBeNull();
    expect(mainStep("deploy", tpl("deploy-contract"))).not.toBeNull();
  });

  it("inputs one per line keep numbers and booleans typed", () => {
    expect(linesToArgs("hello\n42\ntrue\n\n")).toEqual(["hello", 42, true]);
    expect(argsToLines(["hello", 42, true])).toBe("hello\n42\ntrue");
  });
});
