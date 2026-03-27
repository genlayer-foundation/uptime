import { SlaIntegrationContent } from "./SlaIntegrationContent";

export const metadata = {
  title: "SLA Integration | Uptime by GenLayer",
  description:
    "Trustless SLA enforcement with Internet Court. Auto-payable service level agreements backed by on-chain uptime evidence.",
};

export default function SlaIntegrationPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <SlaIntegrationContent />
    </main>
  );
}
