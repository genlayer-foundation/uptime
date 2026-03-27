import { HeroSection } from "@/components/HeroSection";
import { Dashboard } from "@/components/Dashboard";
import { VerificationBanner } from "@/components/VerificationBanner";
import { EcosystemSection } from "@/components/EcosystemSection";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <HeroSection />

      <div className="space-y-10">
        <Dashboard />
        <VerificationBanner />
        <EcosystemSection />
      </div>

      <footer className="mt-16 flex items-center justify-between border-t border-border/60 pt-6 pb-8">
        <div className="flex items-center gap-2 text-xs text-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-3.5 w-3.5 text-purple"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <span>Trustless uptime monitoring</span>
        </div>
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
          <a
            href="https://genlayer.com"
            className="transition-colors hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Powered by GenLayer
          </a>
        </div>
      </footer>
    </main>
  );
}
