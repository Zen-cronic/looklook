import { baseUrl } from "@/lib/app/http";
import { linkFromRawQuery } from "@/lib/app/share";

/**
 * The iPhone Shortcut's link door: it opens `/s?u=<the shared link>` with the
 * link pasted in as it is, not URL-encoded, so the Shortcut needs no encoding
 * step. Everything after `u=` is the link (its own `?` and `&` included), and
 * the browser is sent on to `/check?url=…`, which checks it like the
 * store-link box.
 */
export async function GET(request: Request) {
  const base = await baseUrl();
  const link = linkFromRawQuery(new URL(request.url).search);
  const target = link ? `${base}/check?${new URLSearchParams({ url: link })}` : `${base}/check?share_error=missing`;
  return new Response(null, { status: 303, headers: { location: target, "cache-control": "no-store" } });
}
