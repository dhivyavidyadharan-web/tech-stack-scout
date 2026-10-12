import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic Auth gate. The API writes with the Supabase service-role
 * key, so a public deployment should not be open to anyone with the URL.
 * Set DASHBOARD_PASSWORD to enable (any username). The cron route is excluded
 * because it has its own CRON_SECRET bearer check.
 */
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tech Stack Scout", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
