import { QUESTIONS, type QuestionKind } from "@/lib/heartbeat/questions";
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
      <td className="num">{graded ? pct(accuracy(s), 0) : <span className="hb-muted">n/a</span>}</td>
      <td className="num">{pct(s?.agreement, 0)}</td>
      <td className="num">{s?.undetermined ? s.undetermined : s?.total ? 0 : DASH}</td>
      <td className="num">{duration(s?.latencyP50)}</td>
      <td className="num">{s?.total ?? 0}</td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="num">Accuracy</th>
        <th className="num">Agreement</th>
        <th className="num">Undetermined</th>
        <th className="num">p50</th>
        <th className="num">n</th>
      </tr>
    </thead>
  );
}

export function Breakdown({ data }: { data: HeartbeatData | null }) {
  return (
    <div className="hb-table-2">
      <div className="gl-card">
        <div className="gl-card__header">
          <div>
            <h3 className="gl-card__title">By question kind</h3>
            <p className="gl-card__sub">Two questions per tick, drawn from a fixed set of 16</p>
          </div>
        </div>
        <div className="hb-scroll">
          <table className="gl-table">
            <Head first="Kind" />
            <tbody>
              {KINDS.map((k) => (
                <tr key={k}>
                  <td>
                    <div>{k}</div>
                    <div className="hb-q__kind">{KIND_NOTES[k]}</div>
                  </td>
                  <Cells s={data?.byQuestionKind[k]} graded={k !== "borderline"} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="gl-card">
        <div className="gl-card__header">
          <div>
            <h3 className="gl-card__title">By question</h3>
            <p className="gl-card__sub">Prompts live in the contract; answers are graded off-chain</p>
          </div>
        </div>
        <div className="hb-scroll">
          <table className="gl-table">
            <Head first="Question" />
            <tbody>
              {QUESTIONS.map((q) => (
                <tr key={q.qid}>
                  <td>
                    <div className="mono">{q.qid}</div>
                    <div className="hb-q__kind">{q.kind}</div>
                  </td>
                  <Cells s={data?.byQuestion[q.qid]} graded={q.accept.length > 0} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
