import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  if (isApiRoute(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/sign-in", request.url));
});

export const config = {
  matcher: [
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
  ],
};
