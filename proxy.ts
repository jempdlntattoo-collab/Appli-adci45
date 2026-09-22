import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (!isPublicRoute) await auth.protect();
});

export const config = {
  matcher: [
    "/",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
  ],
};
