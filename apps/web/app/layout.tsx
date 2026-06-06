import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavSidebar } from "@/components/nav-sidebar";
import { StartupGate } from "@/components/startup-gate";
import { CommandPalette } from "@/components/command-palette";
import "./globals.css";
import "highlight.js/styles/github-dark.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lantern — self-hosted AI workspace",
  description: "Your own local-first AI workspace. Carry your own light.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before paint to avoid a flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('lantern-theme');var d=document.documentElement;d.classList.remove('light','dark');if(t==='light')d.classList.add('light');else if(t==='dark')d.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="h-full overflow-hidden">
        <StartupGate>
          <div className="h-full flex flex-row">
            <NavSidebar />
            <main className="flex-1 overflow-auto h-full">
              {children}
            </main>
            <CommandPalette />
          </div>
        </StartupGate>
      </body>
    </html>
  );
}
