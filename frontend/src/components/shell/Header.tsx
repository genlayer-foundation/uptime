"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { ButtonLink, cn } from "@/components/ui";
import { NAV_ITEMS, isActive } from "./nav";
import { SignInButton } from "./SignInButton";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      {/* the original Uptime pulse mark */}
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-purple" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">Uptime</span>
      <span className="hidden text-xs text-muted sm:inline">by GenLayer</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Brand />

        <div className="flex items-center gap-5">
          <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item, pathname) ? "page" : undefined}
                className={cn(
                  "text-sm transition-colors",
                  isActive(item, pathname) ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <ButtonLink href="/jobs/new" size="sm" variant="primary" className="hidden sm:inline-flex">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New job
          </ButtonLink>
          <SignInButton />
        </div>
      </div>

      {/* narrow screens: the nav moves to a second row */}
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-5 overflow-x-auto px-4 pb-3 md:hidden" aria-label="Main (mobile)">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap text-sm transition-colors",
              isActive(item, pathname) ? "text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
        <Link href="/jobs/new" className="whitespace-nowrap text-sm text-muted transition-colors hover:text-foreground sm:hidden">
          New job
        </Link>
      </nav>
    </header>
  );
}
