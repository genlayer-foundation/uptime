"use client";

import { ArrowRight } from "lucide-react";

const ECOSYSTEM_CARDS = [
  {
    title: "Prediction Markets",
    description:
      "Build prediction markets on real-world events powered by AI consensus.",
    links: [
      {
        label: "Try Demo",
        href: "https://testnet-quest.genlayerlabs.com/",
      },
      {
        label: "Docs",
        href: "https://docs.genlayer.com/developers/intelligent-contracts/examples/prediction",
      },
    ],
  },
  {
    title: "Cross-Chain Bridge",
    description:
      "Bridge data and assets across chains with GenLayer + LayerZero.",
    links: [
      {
        label: "Boilerplate",
        href: "https://github.com/genlayerlabs/genlayer-project-boilerplate",
      },
    ],
  },
  {
    title: "Developer Docs",
    description:
      "Build your own Intelligent Contract. Start from the boilerplate or fork this project.",
    links: [
      {
        label: "Docs",
        href: "https://docs.genlayer.com/",
      },
      {
        label: "This Repo",
        href: "https://github.com/genlayer-foundation/uptime",
      },
    ],
  },
];

export function EcosystemSection() {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
        Build Your Own
      </h2>
      <p className="mt-2 text-sm text-muted">
        Intelligent Contracts can do more than uptime monitoring.
      </p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {ECOSYSTEM_CARDS.map((card) => (
          <div
            key={card.title}
            className="bg-background p-5"
          >
            <h3 className="text-sm font-medium text-foreground">
              {card.title}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {card.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-4">
              {card.links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
                >
                  {link.label}
                  <ArrowRight className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
