import type { Metadata } from "next";
import { HeartbeatDashboard } from "@/components/heartbeat/HeartbeatDashboard";

export const metadata: Metadata = {
  title: "Example job: Bradbury Heartbeat",
  description:
    "An hourly job on Testnet Bradbury: canary deploys, web fetches and questions with known answers, graded for correctness, validator agreement and time to decision.",
};

export default function BradburyHeartbeatPage() {
  return <HeartbeatDashboard />;
}
