// App navigation. One list drives the header (desktop and mobile).
export interface NavItem {
  href: string;
  label: string;
  /** Path prefixes that mark this item active (defaults to href). */
  match?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/jobs", label: "Jobs", match: ["/jobs"] },
  { href: "/examples/bradbury-heartbeat", label: "Example", match: ["/examples"] },
  { href: "/#how-it-works", label: "How It Works" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href.includes("#")) return false;
  return (item.match ?? [item.href]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
