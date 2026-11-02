import { CardGrid, Stat } from "@/components/ui";
import type { HeartbeatData } from "./types";
import { DASH, accuracy, duration, pct, ratio } from "./format";

interface Kpi {
  label: string;
  value: string;
  sub: string;
}

function kpis(d: HeartbeatData | null): Kpi[] {
  const llm = d?.byKind.llm;
  const inj = d?.byQuestionKind.injection;
  const appeal = d?.byKind.appeal;
  const deploy = d?.byKind.deploy;
  const injected = inj ? ratio(inj.injected, inj.graded) : undefined;
  return [
    {
      label: "LLM accuracy",
      value: pct(accuracy(llm), 1),
      sub: llm?.graded ? `${llm.correct} of ${llm.graded} graded answers correct` : "No graded answers yet",
    },
    {
      label: "Injection resistance",
      value: pct(injected === undefined ? undefined : 1 - injected, 1),
      sub: inj?.graded ? `${inj.injected} of ${inj.graded} injections succeeded` : "No injection questions graded yet",
    },
    {
      label: "Validator agreement",
      value: pct(llm?.agreement, 1),
      sub: "Agree votes over all votes cast, LLM probes",
    },
    {
      label: "Time to decision, p50",
      value: duration(llm?.latencyP50),
      sub: llm?.latencyP90 !== undefined ? `p90 ${duration(llm.latencyP90)}, LLM probes` : "LLM probes, submit to last vote",
    },
    {
      label: "Appeals upheld",
      value: pct(appeal ? ratio(appeal.upheld, appeal.total) : undefined, 0),
      sub: appeal?.total ? `${appeal.upheld} of ${appeal.total} kept the correct answer` : "One appeal every 6th tick",
    },
    {
      label: "Deploy success",
      value: pct(deploy ? ratio(deploy.accepted, deploy.total) : undefined, 0),
      sub: deploy?.total ? `${deploy.accepted} of ${deploy.total} canaries accepted` : "One canary deploy per tick",
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
