import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono, Archivo } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Marble Grand Prix brand face (Phase 12): Archivo, an athletic grotesk, at
// extrabold — used for the "Marble Grand Prix" wordmark and landing hero/
// section display headings (via the font-display utility). Its industrial,
// slightly geometric character reads as its own brand next to the Inter body,
// with no italic/checkered-flag cliché. (The true Expanded width isn't
// available through next/font in this Next version; standard Archivo extrabold
// with tight tracking is the stand-in — a self-hosted Archivo Expanded is a
// drop-in later.) Body + in-app headings stay Inter (--font-sans /
// --font-heading); numeric data stays Geist Mono. Exposed as --font-logo
// (wordmark) and aliased to --font-display in globals.css.
const archivo = Archivo({
  variable: "--font-logo",
  weight: ["700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: "Marble Grand Prix",
  description: "Private, invite-only racing prediction pools among friends.",
  // Belt-and-suspenders alongside app/robots.ts: invite-only means no page
  // should ever be indexed, even if a crawler ignores robots.txt.
  robots: { index: false, follow: false },
  // iOS has no install API at all (no beforeinstallprompt) — this is what
  // makes "Add to Home Screen" open the app full-screen, without Safari's
  // own chrome, once a visitor does that manually (see InstallAppButton).
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Marble Grand Prix" },
  // Next.js 16's appleWebApp.capable stopped emitting the actual
  // apple-mobile-web-app-capable meta tag (checked its compiled output —
  // genuinely dropped, not a bug here) — that tag is still what makes
  // older iOS versions honor full-screen mode, so it's added directly
  // rather than relying solely on the manifest's display: "standalone".
  other: { "apple-mobile-web-app-capable": "yes" },
};

// Drives the browser chrome color (Android's status bar, Safari's tab bar)
// once installed to a home screen — matches globals.css's brand blue per
// theme (light --accent-primary, dark --primary button fill), since the
// manifest's own theme_color can't vary by scheme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f46e5" },
    { media: "(prefers-color-scheme: dark)", color: "#5257e6" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
