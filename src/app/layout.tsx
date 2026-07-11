import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Agentic Labs Design System fonts:
//   Display  = Martian Grotesk (font-stretch: 85%, weight 600)
//              → Martian Grotesk is not on Google Fonts; Space Grotesk is the
//                closest geometric grotesk available and shares the same
//                wide-shouldered, slightly-condensed character.
//   Body     = Inter Variable (16.5px, weight 400)
//   Mono     = Martian Mono → JetBrains Mono (same geometric mono family feel)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Discord Issue Tracker — Agentic Labs",
  description: "Track Discord forum issues, identify common themes, and monitor user counts.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
