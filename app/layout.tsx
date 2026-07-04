import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Faktencheck-Inbox",
  description: "Findet Falschinformationen zu Ernährung, Fitness & Gesundheit und bereitet Richtigstellungen vor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink text-paper">{children}</body>
    </html>
  );
}
