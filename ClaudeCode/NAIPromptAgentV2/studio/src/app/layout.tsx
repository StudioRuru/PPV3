import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "NAI Studio", description: "NovelAI V5 prompt studio",
  appleWebApp: { capable: true, title: "Studio", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-icon.png" },
};
export const viewport: Viewport = {
  themeColor: "#0d1020",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme/style on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning className={`h-full antialiased ${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-bg text-fg min-h-full pt-[env(safe-area-inset-top)]">
        {children}
      </body>
    </html>
  );
}
