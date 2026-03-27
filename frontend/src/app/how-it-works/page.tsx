import { HowItWorksContent } from "./HowItWorksContent";

export const metadata = {
  title: "How It Works — GenLayer Uptime",
  description:
    "Learn how GenLayer's trustless uptime monitoring uses consensus and intelligent contracts to provide tamper-proof infrastructure monitoring.",
};

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <HowItWorksContent />
    </main>
  );
}
