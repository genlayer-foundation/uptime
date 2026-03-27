import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Uptime by GenLayer — Trustless Infrastructure Monitoring",
  description:
    "The first uptime monitor that can't lie. Every health check independently verified by multiple validators and stored permanently on-chain.",
  metadataBase: new URL("https://uptime.dev.genlayer.foundation"),
  openGraph: {
    title: "Uptime by GenLayer",
    description:
      "Every check verified. Every result on-chain. Trustless uptime monitoring for GenLayer infrastructure.",
    url: "https://uptime.dev.genlayer.foundation",
    siteName: "Uptime by GenLayer",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Uptime by GenLayer",
    description:
      "The first uptime monitor that can't lie. Consensus-verified health checks stored on-chain.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <Header />
          <div className="flex-1">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
