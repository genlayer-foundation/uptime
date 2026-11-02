import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/** Horizontally scrollable table, in the style of the old comparison table. */
export function Table({
  className,
  minWidth = 640,
  bordered = false,
  ...rest
}: { minWidth?: number; bordered?: boolean } & HTMLAttributes<HTMLTableElement>) {
  return (
    <div className={cn("overflow-x-auto", bordered && "rounded-lg border border-border")}>
      <table className={cn("w-full text-sm", className)} style={{ minWidth }} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border bg-surface", className)} {...rest} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border/50 last:border-0", className)} {...rest} />;
}

export function Th({ className, num, ...rest }: { num?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("px-4 py-3 text-xs font-medium text-muted", num ? "text-right" : "text-left", className)}
      {...rest}
    />
  );
}

export function Td({ className, num, ...rest }: { num?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-3 align-top text-sm text-foreground", num && "text-right font-mono tabular-nums", className)}
      {...rest}
    />
  );
}

/** A full-width row for "nothing here yet". */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-xs text-muted">
        {children}
      </td>
    </tr>
  );
}
