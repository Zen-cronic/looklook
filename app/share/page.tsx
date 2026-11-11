import Link from "next/link";
import { SHORTCUT_BASE, SHORTCUT_NAME } from "@/lib/app/shortcut";
import { APP_NAME } from "@/lib/brand";
import styles from "./share.module.css";

export const metadata = { title: "Share from your phone" };

/**
 * How to send a post to LookLook from a phone's share sheet: the "Look twice"
 * Shortcut on an iPhone, the installed app on Android. Written for a phone
 * screen; the build-it-yourself steps are folded away.
 */
export default function SharePage() {
  const host = SHORTCUT_BASE.replace(/^https:\/\//, "");
  return (
    <main className="page">
      <div className="page-head">
        <h1>Share from your phone</h1>
        <p className="lede">
          Saw something in Safari, Instagram, TikTok or Photos? Share it to {APP_NAME} and the verdict opens in your browser.
        </p>
        <p className="small" data-testid="share-status">
          Status: tested on desktop; phone test after deploy.
        </p>
      </div>

      <div className="stack-lg">
        <section className="card stack-sm" data-testid="share-iphone">
          <h2>iPhone</h2>
          <ol className={`${styles.steps} stack-sm`}>
            <li>
              Open this page in Safari on your iPhone and tap <strong>Get the Shortcut</strong>.
              <div className="actions" style={{ marginTop: "0.5rem" }}>
                <a className="btn" href="/share/shortcut" data-testid="get-shortcut">
                  Get the Shortcut
                </a>
              </div>
            </li>
            <li>
              If Safari asks to download &ldquo;{SHORTCUT_NAME}.shortcut&rdquo;, tap <strong>Download</strong>, then open the file from Safari&apos;s Downloads list (or the Files app, in Downloads). The Shortcuts app opens: tap <strong>Add Shortcut</strong>.
            </li>
            <li>
              In Safari or Photos, tap <strong>Share</strong>, then <strong>{SHORTCUT_NAME}</strong> (scroll the row of actions to the end, or tap <strong>Edit Actions</strong> to add it to your favourites).
            </li>
            <li>
              The first time you share an image, it asks to send it to {host}: tap <strong>Allow</strong>. The Check page opens and the verdict follows in under a minute.
            </li>
          </ol>
          <details className="disclosure">
            <summary>Or build the Shortcut yourself</summary>
            <ol className={`${styles.steps} stack-sm`} style={{ marginTop: "0.75rem" }}>
              <li>
                In <strong>Shortcuts</strong>, tap <strong>+</strong>, name it <strong>{SHORTCUT_NAME}</strong>, tap <strong>ⓘ</strong> and turn on <strong>Show in Share Sheet</strong>.
              </li>
              <li>
                Add <strong>Get URLs from Input</strong>, then <strong>If</strong> <em>URLs has any value</em>.
              </li>
              <li>
                Inside the If: <strong>Text</strong> <code>{SHORTCUT_BASE}/s?u=</code> with the <strong>URLs</strong> variable right after the <code>=</code>, then <strong>Open URLs</strong>.
              </li>
              <li>
                Under Otherwise: <strong>Convert Image</strong> (Shortcut Input) to <strong>JPEG</strong>, then <strong>Get Contents of URL</strong> <code>{SHORTCUT_BASE}/api/share?reply=url</code> with Method <strong>POST</strong> and Request Body <strong>File</strong> = <strong>Converted Image</strong>, then <strong>Open URLs</strong>.
              </li>
            </ol>
          </details>
        </section>

        <section className="card stack-sm" data-testid="share-android">
          <h2>Android</h2>
          <ol className={`${styles.steps} stack-sm`}>
            <li>
              Open {APP_NAME} in Chrome, tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
            </li>
            <li>
              Share a link, a post or a screenshot and pick <strong>{APP_NAME}</strong>.
            </li>
          </ol>
        </section>

        <section className="stack-sm">
          <h2>What you can share</h2>
          <ul className={`${styles.points} stack-sm`}>
            <li>A store page: checked against the product catalogue.</li>
            <li>Any other page, a post or an image link: {APP_NAME} reads the picture the page shows when its link is pasted in a chat.</li>
            <li>A screenshot or photo, up to 15&nbsp;MB. Big ones are made smaller first.</li>
          </ul>
          <p className="small">
            Or skip the share sheet: <Link href="/check">add a screenshot or paste a link on the Check page</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
