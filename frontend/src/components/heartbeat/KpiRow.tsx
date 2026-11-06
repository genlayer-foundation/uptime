import { CardGrid, Stat } from "@/components/ui";
import type { HeartbeatData } from "./types";
import { DASH, accuracy, duration, pct, ratio } from "./format";

interface Kpi {
  label: string;
  value: string;
  sub: string;
}

// One card per test type, then appeals. Each card's headline is the share of
// probes the contract graded correct (deploy: canary accepted and holding its
// tick; write: bump landed).
function kpis(d: HeartbeatData | null): Kpi[] {
  const t = d?.byType;
  const graded = (s: HeartbeatData["appeals"] | undefined, none: string, what: string) =>
    s?.graded ? `${s.correct} of ${s.graded} ${what}` : none;
  const deploy = t?.deploy;
  const write = t?.write;
  const llm = t?.llm;
  const web = t?.web;
  const image = t?.image;
  const appeals = d?.appeals;
  const injection = d?.byProbe["r6-injection"];
  const decidedAppeals = appeals ? appeals.upheld + appeals.overturned + appeals.withdrawn : 0;
  return [
    {
      label: "Deploy",
      value: pct(deploy ? ratio(deploy.correct, deploy.total) : undefined, 0),
      sub: deploy?.total
        ? `${deploy.correct} of ${deploy.total} canaries live · p50 ${duration(deploy.latencyP50)} to accepted, ${duration(deploy.finalizedP50)} to finalized`
        : "One Canary deploy per run",
    },
    {
      label: "Write",
      value: pct(write ? ratio(write.correct, write.total) : undefined, 0),
      sub: write?.total ? `${write.correct} of ${write.total} writes landed · p50 ${duration(write.latencyP50)}` : "One plain write per run, no web, no AI",
    },
    {
      label: "AI answers",
      value: pct(accuracy(llm), 1),
      sub: llm?.graded ? `${graded(llm, "", "graded correct")} · agreement ${pct(llm.agreement, 0)}` : "No graded answers yet",
    },
    {
      label: "Web",
      value: pct(accuracy(web), 1),
      sub: web?.graded
        ? `${graded(web, "", "graded correct")} · injection resisted ${pct(injection?.graded ? 1 - injection.injected / injection.graded : undefined, 0)}`
        : "No graded answers yet",
    },
    {
      label: "Image",
      value: pct(accuracy(image), 1),
      sub: image?.graded ? `${graded(image, "", "graded correct")} · agreement ${pct(image.agreement, 0)}` : "No graded answers yet",
    },
    {
      label: "Appeals upheld",
      value: pct(appeals ? ratio(appeals.upheld, decidedAppeals) : undefined, 0),
      sub: decidedAppeals
        ? `${appeals!.upheld} upheld, ${appeals!.overturned} overturned, ${appeals!.withdrawn} withdrawn`
        : "One appeal every 5th run, cycling all 9 questions",
    },
  ];
}

export function KpiRow({ data }: { data: HeartbeatData | null }) {
  return (
    <CardGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {kpis(data).map((k) => (
        <Stat key={k.label} label={k.label} value={k.value} sub={k.sub} empty={k.value === DASH} />
      ))}
    </CardGrid>
  );
}
