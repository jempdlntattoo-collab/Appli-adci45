import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { PwaRegister } from "./pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suivi Chantier",
  description: "Agenda partagé, documents, photos et suivi d’équipe.",
  applicationName: "Suivi Chantier",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Suivi Chantier",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#165b54",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">
        <PwaRegister />
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          afterSignOutUrl="/sign-in"
          appearance={{ theme: shadcn }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}