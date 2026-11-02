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
    return r.upheld ? <Badge tone="success">upheld</Badge> : <Badge tone="danger">overturned</Badge>;
  }
  if (!r.grade) return <Dash />;
  const tone: Tone = r.grade === "correct" ? "success" : r.grade === "ungraded" ? "neutral" : "danger";
  return <Badge tone={tone}>{r.grade}</Badge>;
}

export function RecentProbes({ data }: { data: HeartbeatData | null }) {
  const recent = data?.recent ?? [];
  const explorer = data?.explorerUrl;
  return (
    <Card>
      <CardHeader title="Recent probes" subtitle="The last 50 resolved probes in this window, newest first" />
      <Table minWidth={760}>
        <THead>
          <tr>
            <Th num>Tick</Th>
            <Th>Kind</Th>
            <Th>Question</Th>
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
              No probes resolved yet. The first rows land after the next hourly tick is reconciled.
            </EmptyRow>
          ) : (
            recent.map((r) => (
              <Tr key={r.id}>
                <Td num>{r.tick}</Td>
                <Td>{r.kind}</Td>
                <Td className="font-mono text-xs">{r.qid ?? <Dash />}</Td>
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
