import { HowItWorksContent } from "./HowItWorksContent";

export const metadata = {
  title: "How It Works | Uptime by GenLayer",
  description:
    "Learn how GenLayer's trustless uptime monitoring uses consensus and intelligent contracts to provide tamper-proof infrastructure monitoring.",
};

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <HowItWorksContent />
    </main>
  );
}
