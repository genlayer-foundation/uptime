import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** The one page container: same width and gutters as the original site. */
export function PageContainer({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <main className={cn("mx-auto w-full max-w-5xl px-4 pb-12", className)} {...rest} />;
}

/** Page title block. `title` may carry a muted second half, as the old hero did. */
export function PageHeader({
  eyebrow,
  title,
  muted,
  lede,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  muted?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="py-10 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          {eyebrow ? <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">{eyebrow}</p> : null}
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {title}
            {muted ? <> <span className="text-muted">{muted}</span></> : null}
          </h1>
          {lede ? <p className="mt-4 text-base leading-relaxed text-muted">{lede}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** A section with the old uppercase label heading and a hairline above. */
export function Section({
  title,
  subtitle,
  actions,
  divider = true,
  className,
  children,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  divider?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn(divider && "border-t border-border pt-8", "scroll-mt-32", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Dashed placeholder box for "nothing here yet". */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children ? <div className="mt-2 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** Label + big mono value + sub line, as in the old service cards. */
export function Stat({ label, value, sub, empty }: { label: ReactNode; value: ReactNode; sub?: ReactNode; empty?: boolean }) {
  return (
    <div className="bg-background p-5">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 font-mono text-2xl", empty ? "text-subtle" : "text-foreground")}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}
