import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plypost | Social post drafts and reminders",
  description: "Write platform-specific drafts, plan reminders, and prepare posts for manual publishing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Script id="socialflow-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `try{var p=localStorage.getItem('socialflow-theme');document.documentElement.dataset.theme=p==='light'||p==='dark'?p:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}` }} />
      </body>
    </html>
  );
}
