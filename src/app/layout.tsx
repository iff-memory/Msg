import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Secret Message Box 🔐",
  description: "A private little space to share what's on your mind.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-midnight text-ink antialiased">{children}</body>
    </html>
  );
}
