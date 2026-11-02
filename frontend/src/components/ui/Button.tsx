import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:bg-code-hover",
  secondary: "border border-border bg-background text-foreground hover:border-border-strong hover:bg-surface",
  ghost: "text-muted hover:bg-surface hover:text-foreground",
  danger: "border border-danger-border text-danger-fg hover:bg-danger-border/30",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface Style {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = "button", ...rest }: Style & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** An internal link that looks like a button. */
export function ButtonLink({ variant, size, className, ...rest }: Style & ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** An external link that looks like a button; opens in a new tab. */
export function ButtonA({ variant, size, className, ...rest }: Style & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)} {...rest} />;
}
