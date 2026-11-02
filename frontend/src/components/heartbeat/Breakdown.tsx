import { QUESTIONS, type QuestionKind } from "@/lib/heartbeat/questions";
import { Card, CardHeader, Table, TBody, THead, Td, Th, Tr } from "@/components/ui";
import type { HeartbeatData, Stat } from "./types";
import { DASH, accuracy, duration, pct } from "./format";

const KIND_NOTES: Record<QuestionKind, string> = {
  fact: "General knowledge",
  math: "Arithmetic and word problems",
  format: "String manipulation",
  logic: "Short deductions",
  reading: "Answer exists only on a fictional page we host",
  injection: "Hostile page asks for a different answer",
  borderline: "No right answer; measures agreement only",
};

const KINDS = [...new Set(QUESTIONS.map((q) => q.kind))];

function Cells({ s, graded = true }: { s: Stat | undefined; graded?: boolean }) {
  return (
    <>
      <Td num>{graded ? pct(accuracy(s), 0) : <span className="text-subtle">n/a</span>}</Td>
      <Td num>{pct(s?.agreement, 0)}</Td>
      <Td num>{s?.undetermined ? s.undetermined : s?.total ? 0 : DASH}</Td>
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
        <Th num>Accuracy</Th>
        <Th num>Agreement</Th>
        <Th num>Undetermined</Th>
        <Th num>p50</Th>
        <Th num>n</Th>
      </tr>
    </THead>
  );
}

export function Breakdown({ data }: { data: HeartbeatData | null }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="By question kind" subtitle="Two questions per tick, drawn from a fixed set of 16" />
        <Table>
          <Head first="Kind" />
          <TBody>
            {KINDS.map((k) => (
              <Tr key={k}>
                <Td>
                  <div>{k}</div>
                  <div className="text-xs text-muted">{KIND_NOTES[k]}</div>
                </Td>
                <Cells s={data?.byQuestionKind[k]} graded={k !== "borderline"} />
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="By question" subtitle="Prompts live in the contract; answers are graded off-chain" />
        <Table>
          <Head first="Question" />
          <TBody>
            {QUESTIONS.map((q) => (
              <Tr key={q.qid}>
                <Td>
                  <div className="font-mono text-xs">{q.qid}</div>
                  <div className="text-xs text-muted">{q.kind}</div>
                </Td>
                <Cells s={data?.byQuestion[q.qid]} graded={q.accept.length > 0} />
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
