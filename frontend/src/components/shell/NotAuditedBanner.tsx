import { TriangleAlert } from "lucide-react";

// Rendered by the root layout on every page, inside the sticky header block,
// so it never scrolls away and cannot be dismissed. Owner decision: keep it
// until the contracts are audited and the app leaves testnet.
export function NotAuditedBanner() {
  return (
    <div role="alert" className="border-b-2 border-banner-border bg-banner-bg text-banner-fg">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-2.5 px-4 py-3 text-center text-sm font-bold uppercase tracking-wide sm:text-base">
        <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
        <span>
          Not audited — testnet only. Do not deposit anything you can&apos;t lose.
        </span>
      </div>
    </div>
  );
}
