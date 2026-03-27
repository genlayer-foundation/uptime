import { HeroSection } from "@/components/HeroSection";
import { Dashboard } from "@/components/Dashboard";
import { VerificationBanner } from "@/components/VerificationBanner";
import { EcosystemSection } from "@/components/EcosystemSection";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-10">
        <HeroSection />

        <Dashboard />

        <VerificationBanner />

        <EcosystemSection />
      </div>

      <footer className="mt-12 border-t border-white/5 pt-6 pb-8 text-center text-xs text-gray-600">
        Powered by{" "}
        <a
          href="https://genlayer.com"
          className="text-purple hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          GenLayer
        </a>{" "}
        Intelligent Contracts
      </footer>
    </main>
  );
}
