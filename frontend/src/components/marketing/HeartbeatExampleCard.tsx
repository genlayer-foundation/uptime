import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";

/** The Bradbury Heartbeat as a public example, linking to its results page. */
export function HeartbeatExampleCard() {
  return (
    <Link href="/examples/bradbury-heartbeat" className="block">
      <Card interactive className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-4 w-4 text-purple" aria-hidden />
            <div>
              <h3 className="text-sm font-medium text-foreground">Bradbury Heartbeat</h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                Every hour on GenLayer Testnet Bradbury: deploy a canary, write state, fetch a page, and run two probes
                (LLM, web or image) that the Intelligent Contract grades itself. Plus an appeal every fifth hour.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
            View results
            <ArrowRight className="h-3 w-3" aria-hidden />
          </span>
        </div>
      </Card>
    </Link>
  );
}
