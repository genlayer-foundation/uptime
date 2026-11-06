import type { Metadata } from "next";
import { HeartbeatDashboard } from "@/components/heartbeat/HeartbeatDashboard";

export const metadata: Metadata = {
  title: "Live example: Bradbury Heartbeat",
  description:
    "Our own hourly job on GenLayer Testnet Bradbury: five actions on two contracts every run, graded on-chain against answers we know in advance, with an appeal every 5th run.",
};

export default function BradburyHeartbeatPage() {
  return <HeartbeatDashboard />;
}
