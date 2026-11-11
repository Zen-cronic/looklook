import Link from "next/link";

export const metadata = { title: "Page not found" };

/** Any address that isn't a page: say so plainly and offer the two places to start. */
export default function NotFound() {
  return (
    <main className="page">
      <div className="page-head">
        <h1>Page not found</h1>
        <p className="lede">There is no page at this address. It may be an old link, or a check or receipt from another browser.</p>
      </div>
      <div className="actions">
        <Link className="btn" href="/week">
          Go to this week
        </Link>
        <Link className="btn outline" href="/check">
          Check a post
        </Link>
      </div>
    </main>
  );
}
