import type { Metadata, Viewport } from "next";
import { Chivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// §14 Typography — Chivo for display, Inter for UI, JetBrains Mono for the tape.
const chivo = Chivo({
  variable: "--font-chivo",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Swiftgrocers POS",
  description: "Point of sale for Swiftgrocers. Built by BitLayerX Technologies.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // The leaf green from public/logo.png — matches the icon tile in icon.svg.
  themeColor: "#69a320",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${chivo.variable} ${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
