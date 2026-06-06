import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Chakra_Petch, Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra",
});
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pool.mght630.com";
const TITLE = "PoolPilot";
const DESCRIPTION = "Control and monitor the Hicks pool pump";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: TITLE },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#05090e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${outfit.variable} ${jbmono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
