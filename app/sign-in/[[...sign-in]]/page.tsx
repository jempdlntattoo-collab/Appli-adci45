import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/app/auth-shell";

export default function SignInPage() {
  return <AuthShell title="Bon retour" subtitle="Connectez-vous pour accéder à vos chantiers.">
    <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" forceRedirectUrl="/" appearance={{elements:{rootBox:"w-full",cardBox:"w-full",card:"w-full shadow-xl"}}}/>
  </AuthShell>;
}
