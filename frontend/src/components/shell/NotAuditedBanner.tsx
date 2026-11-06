import { TriangleAlert } from "lucide-react";

// Rendered by the root layout on every page, inside the sticky header block,
// so it never scrolls away and cannot be dismissed. Owner decision: keep it
// until the contracts are audited and the app leaves testnet.
export function NotAuditedBanner() {
  return (
    <div role="alert" className="border-b-2 border-banner-border bg-banner-bg text-banner-fg">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-semibold sm:text-sm">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Not audited · testnet only<span className="hidden sm:inline"> — use GEN you can afford to lose</span>
        </span>
      </div>
    </div>
  );
}
