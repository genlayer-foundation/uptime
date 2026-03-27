"use client";

import { ArrowRight, Layers, BookOpen, Zap } from "lucide-react";

const ECOSYSTEM_CARDS = [
  {
    icon: <Zap className="h-5 w-5" />,
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
    icon: <Layers className="h-5 w-5" />,
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
    icon: <BookOpen className="h-5 w-5" />,
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
    <section>
      <div className="mb-5">
        <h2
          className="text-lg font-semibold text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Build Your Own
        </h2>
        <p className="text-sm text-gray-500">
          Intelligent Contracts can do more than uptime monitoring.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {ECOSYSTEM_CARDS.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-purple-500/20"
          >
            <div className="mb-3 text-purple">{card.icon}</div>
            <h3
              className="mb-2 text-sm font-semibold text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {card.title}
            </h3>
            <p className="mb-4 text-xs leading-relaxed text-gray-500">
              {card.description}
            </p>
            <div className="flex flex-wrap gap-3">
              {card.links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-purple hover:underline"
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
