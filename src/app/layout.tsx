import type { Metadata, Viewport } from "next";
import "./globals.css";
import Starfield from "@/components/Starfield";
import Nav from "@/components/Nav";
import { Toasts } from "@/components/Toasts";
import ProcessCompanion from "@/components/ProcessCompanion";

export const metadata: Metadata = {
  title: "VIRAL.forge — Anything viral becomes a coin.",
  description:
    "AI-powered Solana meme coin launcher. Turn a prompt, an X post, a hashtag, a picture, a TikTok or a live trend into a token in seconds. Name, ticker, lore and pixel logo generated for you.",
  applicationName: "VIRAL.forge",
  keywords: [
    "solana meme coin launcher",
    "pump.fun launcher",
    "create solana token",
    "ai meme coin generator",
    "launch token from tweet",
    "trending meme coins",
    "pixel art crypto",
    "memecoin",
    "solana",
  ],
  category: "finance",
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#06070f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <Starfield />
        <div className="app-layer flex min-h-screen flex-col">
          <Toasts>
            <Nav />
            <main className="flex-1">{children}</main>
            <ProcessCompanion />
            <footer className="border-t border-line px-4 py-6">
              <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs text-fg-faint">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="mono">VIRAL.forge</span>
                  <a
                    href="/tokenomics"
                    className="mono hover:text-accent"
                  >
                    tokenomics
                  </a>
                  <span className="mono ml-auto">
                    study build · interaction model after launcher.wtf
                  </span>
                </div>
                <p className="max-w-3xl leading-relaxed">
                  Meme coins are extremely high risk. This tool automates token
                  creation; it does not give financial advice. Launch responsibly
                  and only with funds you can afford to lose. Every coin recorded
                  here is simulated and is not on-chain.
                </p>
              </div>
            </footer>
          </Toasts>
        </div>
      </body>
    </html>
  );
}
