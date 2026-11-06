import { ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader, EmptyRow, Table, TBody, THead, Td, Th, Tr, type Tone } from "@/components/ui";
import type { HeartbeatData, ProbeRecord } from "./types";
import { DASH, duration, shortHash } from "./format";

function statusTone(status: string): Tone {
  if (status === "ACCEPTED" || status === "FINALIZED") return "success";
  if (status === "UNDETERMINED") return "warn";
  return "danger"; // timeouts, CANCELED, SUBMIT_FAILED
}

const Dash = () => <span className="text-subtle">{DASH}</span>;

function Grade({ r }: { r: ProbeRecord }) {
  if (r.kind === "appeal") {
    if (!r.outcome) return <Dash />;
    const tone: Tone = r.outcome === "upheld" ? "success" : r.outcome === "withdrawn" ? "neutral" : "danger";
    return <Badge tone={tone}>{r.outcome}</Badge>;
  }
  if (!r.grade) {
    return r.error && r.status !== "SUBMIT_FAILED" ? (
      <Badge tone="warn" title={r.error}>
        {r.error.startsWith("[EXTERNAL] fixture drift") ? "fixture drift" : "error"}
      </Badge>
    ) : (
      <Dash />
    );
  }
  return <Badge tone={r.grade === "correct" ? "success" : "danger"}>{r.grade}</Badge>;
}

export function RecentProbes({ data }: { data: HeartbeatData | null }) {
  const recent = data?.recent ?? [];
  const explorer = data?.explorerUrl;
  return (
    <Card>
      <CardHeader title="Recent actions" subtitle="The last 50 decided actions in this window, newest first" />
      <Table minWidth={760}>
        <THead>
          <tr>
            <Th num>Run</Th>
            <Th>Type</Th>
            <Th>Action</Th>
            <Th>Status</Th>
            <Th>Answer</Th>
            <Th>Grade</Th>
            <Th num>Latency</Th>
            <Th>Tx</Th>
          </tr>
        </THead>
        <TBody>
          {recent.length === 0 ? (
            <EmptyRow colSpan={8}>
              Nothing decided yet. The first rows land once the next hourly run is decided.
            </EmptyRow>
          ) : (
            recent.map((r) => (
              <Tr key={r.id}>
                <Td num>{r.tick}</Td>
                <Td>{r.kind === "appeal" ? `appeal · ${r.type}` : r.type}</Td>
                <Td className="font-mono text-xs">{r.qid ?? (r.kind === "deploy" ? "canary" : r.kind === "write" ? "bump" : <Dash />)}</Td>
                <Td>
                  {r.status ? (
                    <Badge tone={statusTone(r.status)} title={r.error}>
                      {r.status.replaceAll("_", " ").toLowerCase()}
                    </Badge>
                  ) : (
                    <Dash />
                  )}
                </Td>
                <Td>
                  <div className="max-w-[22ch] truncate font-mono text-xs" title={r.answer}>
                    {r.answer || <Dash />}
                  </div>
                </Td>
                <Td>
                  <Grade r={r} />
                </Td>
                <Td num>{duration(r.latencySec)}</Td>
                <Td>
                  {r.txHash && explorer ? (
                    <a
                      className="inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors hover:text-foreground"
                      href={`${explorer}/tx/${r.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortHash(r.txHash)}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : (
                    <Dash />
                  )}
                </Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </Card>
  );
}
