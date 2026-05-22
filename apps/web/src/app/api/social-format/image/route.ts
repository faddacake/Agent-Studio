export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social-format/image?url=...&w=1080&h=1080
 *
 * Fetches the source image and uses canvas-free CSS object-fit semantics
 * by proxying + setting width/height metadata. When a server-side image
 * processing library (e.g. sharp) is installed, this can be upgraded to
 * actual pixel-level resize. For now it proxies the original image with
 * appropriate cache headers and includes target dimensions as metadata.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get("url");
  const w = parseInt(searchParams.get("w") || "0", 10);
  const h = parseInt(searchParams.get("h") || "0", 10);

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    // Server-side fetch requires absolute URLs. If url is a relative path (e.g.
    // /api/artifacts?path=...) resolve it against the request's own origin so
    // local artifact images work in addition to external CDN URLs.
    const absoluteUrl = url.startsWith("/")
      ? `${new URL(request.url).origin}${url}`
      : url;
    const upstream = await fetch(absoluteUrl);
    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to fetch source image" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Target-Width": String(w),
        "X-Target-Height": String(h),
      },
    });
  } catch (err) {
    console.error("[social-format/image] Proxy error:", err);
    return NextResponse.json({ error: "Image proxy failed" }, { status: 500 });
  }
}
