import { connection } from "next/server";
import { Suspense } from "react";
import { formatTime } from "@/lib/app/dates";
import { listEvents } from "@/lib/app/store";
import type { EventLogEntry } from "@/lib/app/types";
import { Eyebrow } from "../components/Eyebrow";
import { filmOn } from "@/lib/filming/server";
import { neutralDeep } from "@/lib/filming/view";

export const metadata = { title: "Webhook events" };

export default function EventsPage() {
  return (
    <main className="page wide">
      <div style={{ marginBottom: "1.5rem", maxWidth: "44rem" }}>
        <h1>Webhook events</h1>
        <p className="lede">What PayPal and Channel3 sent, whether it was verified, and what it changed.</p>
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          PayPal events are verified with PayPal; Channel3 events by their signature. A repeated event is handled once.
        </p>
        <details className="disclosure step-more" style={{ marginTop: "0.4rem" }}>
          <summary>How events are verified</summary>
          <p>PayPal events are checked with PayPal&apos;s verify-webhook-signature call; Channel3 events with their signing secret (HMAC-SHA256). A repeated event ID is acknowledged and handled once.</p>
        </details>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Events />
      </Suspense>
    </main>
  );
}

function VerificationChip({ e }: { e: EventLogEntry }) {
  switch (e.verification) {
    case "verified":
      return (
        <Eyebrow as="span" icon="check">
          {e.source === "paypal" ? "Verified with PayPal" : "Signature valid"}
        </Eyebrow>
      );
    case "simulated":
      return (
        <Eyebrow as="span" icon="tag">
          Test event from this app
        </Eyebrow>
      );
    case "not-configured":
      return (
        <Eyebrow as="span" icon="clock">
          Not set up
        </Eyebrow>
      );
    default:
      return (
        <Eyebrow as="span" icon="alert" className="eyebrow-alert">
          Rejected{e.failureReason ? `: ${e.failureReason.replace(/-/g, " ")}` : ""}
        </Eyebrow>
      );
  }
}

async function Events() {
  await connection();
  const all = listEvents(100);
  // Filming mode: generic product names in "What it did", PayPal ids shortened.
  const events = (await filmOn()) ? neutralDeep(all, { shortIds: true }) : all;
  if (!events.length) {
    return (
      <div className="empty-frame">
        <Eyebrow icon="receipt">No events yet</Eyebrow>
        <p className="small muted">They appear here when PayPal confirms a payment or a saved method, or Channel3 reports a price change on something you watch.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap stacked">
      <table>
        <thead>
          <tr>
            <th>Received</th>
            <th>From</th>
            <th>Event</th>
            <th>Verified</th>
            <th>What it did</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td data-label="Received" className="mono small" style={{ whiteSpace: "nowrap" }}>
                {formatTime(e.receivedAt)} ET
              </td>
              <td data-label="From">{e.source === "paypal" ? "PayPal" : "Channel3"}</td>
              <td data-label="Event">
                <div className="mono small">{e.type ?? "unknown"}</div>
                {e.eventId && <div className="mono small muted">{e.eventId}</div>}
              </td>
              <td data-label="Verified">
                <span className="eyebrow-stack">
                  <VerificationChip e={e} />
                  {e.duplicate && (
                    <Eyebrow as="span" icon="repeat">
                      Repeat, handled once
                    </Eyebrow>
                  )}
                </span>
              </td>
              <td data-label="What it did" className="small">{e.duplicate ? "Nothing: already handled." : e.state === "failed" ? "Not applied yet: waiting for the sender to retry." : e.state === "processing" && !e.effect ? "Being applied." : (e.effect ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
