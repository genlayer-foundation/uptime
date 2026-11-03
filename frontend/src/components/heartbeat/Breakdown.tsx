import { PROBE_SET, TEST_TYPES, type Equivalence } from "@/lib/heartbeat/probes";
import { Card, CardHeader, Table, TBody, THead, Td, Th, Tr } from "@/components/ui";
import type { HeartbeatData, Stat } from "./types";
import { DASH, accuracy, duration, pct } from "./format";

const EQ: Record<Equivalence, string> = {
  none: "deterministic",
  strict_eq: "strict_eq",
  comparative: "prompt_comparative",
  non_comparative: "prompt_non_comparative",
  custom: "custom validator",
};

function Cells({ s }: { s: Stat | undefined }) {
  return (
    <>
      <Td num>{pct(accuracy(s), 0)}</Td>
      <Td num>{pct(s?.agreement, 0)}</Td>
      <Td num>{s?.undetermined ? s.undetermined : s?.total ? 0 : DASH}</Td>
      <Td num>{s?.errored ? s.errored : s?.total ? 0 : DASH}</Td>
      <Td num>{duration(s?.latencyP50)}</Td>
      <Td num>{s?.total ?? 0}</Td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <THead>
      <tr>
        <Th>{first}</Th>
        <Th num>Correct</Th>
        <Th num>Agreement</Th>
        <Th num>Undetermined</Th>
        <Th num>Errored</Th>
        <Th num>p50</Th>
        <Th num>n</Th>
      </tr>
    </THead>
  );
}

function appealCell(s: Stat | undefined) {
  if (!s?.total) return <span className="text-subtle">{DASH}</span>;
  return `${s.upheld}/${s.overturned}/${s.withdrawn}`;
}

export function Breakdown({ data }: { data: HeartbeatData | null }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="By test type"
          subtitle="Each type is one way real Intelligent Contracts depend on GenLayer. Errored = an agreed contract error, such as fixture drift"
        />
        <Table>
          <Head first="Type" />
          <TBody>
            {TEST_TYPES.map((t) => (
              <Tr key={t.type}>
                <Td>
                  <div>{t.label}</div>
                  <div className="text-xs text-muted">{t.note}</div>
                </Td>
                <Cells s={data?.byType[t.type]} />
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="By probe"
          subtitle="The status fetch runs every tick; the other nine rotate, two per tick. Prompts and answer key live in the Intelligent Contract, which grades each answer. Appeals: upheld / overturned / withdrawn"
        />
        <Table minWidth={760}>
          <THead>
            <tr>
              <Th>Probe</Th>
              <Th>Consensus</Th>
              <Th num>Correct</Th>
              <Th num>Agreement</Th>
              <Th num>Errored</Th>
              <Th num>p50</Th>
              <Th num>n</Th>
              <Th num>Appeals</Th>
            </tr>
          </THead>
          <TBody>
            {PROBE_SET.map((p) => {
              const s = data?.byProbe[p.id];
              return (
                <Tr key={p.id}>
                  <Td>
                    <div className="font-mono text-xs">{p.id}</div>
                    <div className="text-xs text-muted">
                      {p.type} · {p.note}
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">{EQ[p.eq]}</Td>
                  <Td num>{pct(accuracy(s), 0)}</Td>
                  <Td num>{pct(s?.agreement, 0)}</Td>
                  <Td num>{s?.errored ? s.errored : s?.total ? 0 : DASH}</Td>
                  <Td num>{duration(s?.latencyP50)}</Td>
                  <Td num>{s?.total ?? 0}</Td>
                  <Td num>{appealCell(data?.appealsByProbe[p.id])}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
