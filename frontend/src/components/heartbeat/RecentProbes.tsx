import { ExternalLink } from "lucide-react";
import type { HeartbeatData, ProbeRecord } from "./types";
import { DASH, duration, shortHash } from "./format";

function statusTone(status?: string): string {
  if (!status) return "";
  if (status === "ACCEPTED" || status === "FINALIZED") return "gl-badge--success";
  if (status === "UNDETERMINED") return "gl-badge--warn";
  return "gl-badge--danger"; // timeouts, CANCELED, SUBMIT_FAILED
}

function Grade({ r }: { r: ProbeRecord }) {
  if (r.kind === "appeal") {
    return r.upheld ? (
      <span className="gl-badge gl-badge--success">upheld</span>
    ) : (
      <span className="gl-badge gl-badge--danger">overturned</span>
    );
  }
  if (!r.grade) return <span className="hb-muted">{DASH}</span>;
  const tone =
    r.grade === "correct" ? "gl-badge--success" : r.grade === "ungraded" ? "" : "gl-badge--danger";
  return <span className={`gl-badge ${tone}`}>{r.grade}</span>;
}

export function RecentProbes({ data }: { data: HeartbeatData | null }) {
  const recent = data?.recent ?? [];
  const explorer = data?.explorerUrl;
  return (
    <div className="gl-card">
      <div className="gl-card__header">
        <div>
          <h3 className="gl-card__title">Recent probes</h3>
          <p className="gl-card__sub">The last 50 resolved probes in this window, newest first</p>
        </div>
      </div>
      <div className="hb-scroll">
        <table className="gl-table">
          <thead>
            <tr>
              <th className="num">Tick</th>
              <th>Kind</th>
              <th>Question</th>
              <th>Status</th>
              <th>Answer</th>
              <th>Grade</th>
              <th className="num">Latency</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr className="hb-empty-row">
                <td colSpan={8}>No probes resolved yet. The first rows land after the next hourly tick is reconciled.</td>
              </tr>
            ) : (
              recent.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.tick}</td>
                  <td>{r.kind}</td>
                  <td className="mono">{r.qid ?? <span className="hb-muted">{DASH}</span>}</td>
                  <td>
                    {r.status ? (
                      <span className={`gl-badge ${statusTone(r.status)}`} title={r.error}>
                        {r.status.replaceAll("_", " ").toLowerCase()}
                      </span>
                    ) : (
                      <span className="hb-muted">{DASH}</span>
                    )}
                  </td>
                  <td>
                    <div className="hb-answer" title={r.answer}>
                      {r.answer || <span className="hb-muted">{DASH}</span>}
                    </div>
                  </td>
                  <td>
                    <Grade r={r} />
                  </td>
                  <td className="num">{duration(r.latencySec)}</td>
                  <td>
                    {r.txHash && explorer ? (
                      <a className="hb-tx" href={`${explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">
                        {shortHash(r.txHash)}
                        <ExternalLink size={12} aria-hidden />
                      </a>
                    ) : (
                      <span className="hb-muted">{DASH}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
