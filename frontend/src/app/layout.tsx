import type { Metadata } from "next";
import "./globals.css";

const description =
  "An hourly benchmark of Intelligent Contracts on Testnet Bradbury: canary deploys, web fetches and questions with known answers, graded for correctness, validator agreement and time to decision.";

export const metadata: Metadata = {
  title: "Heartbeat · GenLayer Testnet Bradbury",
  description,
  metadataBase: new URL("https://uptime.genlayer.foundation"),
  icons: { icon: "/gl/assets/GenLayer_Mark_Black.svg" },
  openGraph: {
    title: "Heartbeat · GenLayer",
    description,
    url: "https://uptime.genlayer.foundation",
    siteName: "GenLayer Heartbeat",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Heartbeat · GenLayer",
    description,
  },
};

// GenLayer Design System, vendored under public/gl/ from projects/design.
// Order matters: tokens, then components, then theme chrome. The inline
// script sets the theme before first paint (default dark); theme.js wires
// the toggle and persists the choice.
const noFlash =
  "(function(){try{var t=localStorage.getItem('gl-theme')||'dark';document.documentElement.classList.toggle('on-dark',t==='dark');}catch(e){document.documentElement.classList.add('on-dark');}})();";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="on-dark" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/gl/colors_and_type.css" />
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/gl/components.css" />
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/gl/theme.css" />
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body>
        {children}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/gl/theme.js" />
      </body>
    </html>
  );
}
