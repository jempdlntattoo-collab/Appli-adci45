import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suivi Chantier",
  description: "Agenda partagé, documents, photos et suivi d’équipe.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">
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
