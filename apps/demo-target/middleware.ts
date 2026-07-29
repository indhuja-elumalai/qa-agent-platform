import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.cookies.get("demo-session")?.value !== "authenticated") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/agent/:path*", "/safe-form/:path*"] };
