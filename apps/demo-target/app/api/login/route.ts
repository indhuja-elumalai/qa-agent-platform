import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  if (body.email !== "demo@example.test" || body.password !== "demo-password") {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("demo-session", "authenticated", {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    maxAge: 3600,
    path: "/",
  });
  return response;
}
