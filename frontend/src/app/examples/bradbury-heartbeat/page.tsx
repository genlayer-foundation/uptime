import type { Metadata } from "next";
import { HeartbeatDashboard } from "@/components/heartbeat/HeartbeatDashboard";

export const metadata: Metadata = {
  title: "Example job: Bradbury Heartbeat",
  description:
    "An hourly job on Testnet Bradbury with five test types (deploy, write, LLM, web, image) and appeals, graded on-chain for correctness, plus validator agreement and time to decision.",
};

export default function BradburyHeartbeatPage() {
  return <HeartbeatDashboard />;
}
