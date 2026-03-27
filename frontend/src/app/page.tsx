import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple/20">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 text-purple"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div>
            <h1
              className="text-xl font-semibold tracking-tight text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              GenLayer Uptime
            </h1>
            <p className="text-xs text-gray-500">
              Trustless infrastructure monitoring — on-chain SLA proof
            </p>
          </div>
        </div>
      </header>

      <Dashboard />

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
