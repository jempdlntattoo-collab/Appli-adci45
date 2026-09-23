import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  if (isApiRoute(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  return Response.redirect(new URL("/sign-in", request.url), 302);
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
