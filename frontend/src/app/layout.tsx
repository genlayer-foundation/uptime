import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { NotAuditedBanner } from "@/components/shell/NotAuditedBanner";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
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

const description =
  "Uptime you can prove. Independent validators check your website, API or AI answer, agree on the result, and record it where anyone can verify it. Testnet beta, built on GenLayer.";

export const metadata: Metadata = {
  title: {
    default: "Uptime by GenLayer | Uptime you can prove",
    template: "%s | Uptime by GenLayer",
  },
  description,
  metadataBase: new URL("https://uptime.genlayer.foundation"),
  openGraph: {
    title: "Uptime by GenLayer | Uptime you can prove",
    description,
    url: "https://uptime.genlayer.foundation",
    siteName: "Uptime by GenLayer",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Uptime by GenLayer | Uptime you can prove",
    description,
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
        <div className="sticky top-0 z-50">
          <NotAuditedBanner />
          <Header />
        </div>
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
