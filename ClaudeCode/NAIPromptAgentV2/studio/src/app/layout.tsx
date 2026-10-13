import type { Metadata, Viewport } from "next";
import { NavTabs } from "@/components/NavTabs";
import "./globals.css";

export const metadata: Metadata = { title: "NAI Studio", description: "NovelAI V5 prompt studio" };
export const viewport: Viewport = {
  themeColor: "#0e1016",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-bg text-fg min-h-full">
        <NavTabs />
        {children}
      </body>
    </html>
  );
}
