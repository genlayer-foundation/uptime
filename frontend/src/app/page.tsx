import { HeroSection } from "@/components/HeroSection";
import { Dashboard } from "@/components/Dashboard";
import { VerificationBanner } from "@/components/VerificationBanner";
import { EcosystemSection } from "@/components/EcosystemSection";
import { AgentSection } from "@/components/AgentSection";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <HeroSection />
      <AgentSection />

      <div className="space-y-10">
        <Dashboard />
        <VerificationBanner />
        <EcosystemSection />
      </div>

      <footer className="mt-16 flex items-center justify-between border-t border-border pt-6 pb-8">
        <div className="flex items-center gap-6 text-xs text-muted">
          <a
            href="https://github.com/genlayer-foundation/uptime"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href="https://docs.genlayer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Docs
          </a>
        </div>
        <a
          href="https://genlayer.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted transition-colors hover:text-foreground"
        >
          Powered by GenLayer
        </a>
      </footer>
    </main>
  );
}
