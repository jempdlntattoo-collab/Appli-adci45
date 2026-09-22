import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/app/auth-shell";

export default function SignUpPage() {
  return <AuthShell title="Créer votre compte" subtitle="Utilisez votre adresse e-mail et choisissez votre mot de passe.">
    <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" forceRedirectUrl="/" appearance={{elements:{rootBox:"w-full",cardBox:"w-full",card:"w-full shadow-xl"}}}/>
  </AuthShell>;
}
