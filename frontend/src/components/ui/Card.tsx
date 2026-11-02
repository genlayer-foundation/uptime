import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/** Bordered surface. `interactive` adds the old status-card hover. */
export function Card({
  interactive,
  className,
  ...rest
}: { interactive?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background",
        interactive && "transition-colors hover:border-border-strong hover:bg-surface",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-3 border-t border-border px-5 py-3", className)} {...rest} />;
}

/** The old hairline grid: cells separated by 1px borders, e.g. "Build your own". */
export function CardGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border", className)}
      {...rest}
    />
  );
}

export function CardGridCell({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-background p-5", className)} {...rest} />;
}
