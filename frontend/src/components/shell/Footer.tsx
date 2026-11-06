import Link from "next/link";

const REPO = "https://github.com/genlayer-foundation/uptime";

// The original site's footer, now in the root layout so every page has it.
export function Footer() {
  return (
    <footer className="mx-auto mt-16 w-full max-w-5xl border-t border-border px-4 pt-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
            GitHub
          </a>
          <a href="https://docs.genlayer.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
            Docs
          </a>
          <Link href="/examples/bradbury-heartbeat" className="transition-colors hover:text-foreground">
            Live example
          </Link>
        </div>
        <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="text-xs text-muted transition-colors hover:text-foreground">
          Powered by GenLayer
        </a>
      </div>
      <p className="mt-4 text-xs text-subtle">
        Testnet beta by the GenLayer Foundation. Not audited. GenLayer validators decide every result.
      </p>
    </footer>
  );
}
