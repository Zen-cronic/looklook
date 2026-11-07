import { APP_NAME, TAGLINE } from "@/lib/brand";

export default function Home() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>{TAGLINE}</p>
      <p>Work in progress. Payments run in the PayPal sandbox only.</p>
    </main>
  );
}
