/**
 * The Start here path on /judge, as data, so the page, the README's "Try it"
 * list and the tests all read the same steps.
 *
 * The order matters: the price watch comes before the first purchase, because
 * a purchase spends this month's skincare budget and turns the retinol into a
 * wait for next month's budget instead of a wait for a lower price.
 */

export interface StartHereLink {
  href: string;
  label: string;
  outline?: boolean;
}

export interface StartHereStep {
  title: string;
  body: string;
  links: StartHereLink[];
  /** Show the sample-week controls under this step. */
  sampleWeek?: boolean;
}

export interface StartHereNumbers {
  heldOutRight: number;
  heldOutN: number;
  devN: number;
  rebuyLeadDays: number;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "six" for 6; digits past twelve. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export function startHereSteps(n: StartHereNumbers): StartHereStep[] {
  return [
    {
      title: "Load the sample week and check a post",
      body:
        "Load the sample week: a fictional shopper's week of checks on real catalogue products (two skips, four waits, a buy and a cleanser due for a rebuy). On Check, the last check is the sunscreen post. You already own a sunscreen that does the same job, so the answer is skip. Open See why for the rule, the shelf item and the cited store policy, and see the same product at other stores with each store's policy.",
      links: [{ href: "/", label: "Open Check" }],
      sampleWeek: true,
    },
    {
      title: "Wait for a lower price",
      body:
        "Open the retinol check (wait for a lower price) and tap Watch for a drop: Channel3 sets a real price alert at the target. On Rebuys, Send a test price drop runs a price event through the same handler, and the retinol asks for your yes.",
      links: [{ href: "/rebuys", label: "Open Rebuys" }],
    },
    {
      title: "Buy once and save PayPal for rebuys",
      body:
        "Open the peptide serum check (buy) and tap Buy for $32.00 with PayPal. Tick Save this payment method, keep the per-rebuy cap, and pay with PayPal or the card fields, using the sandbox login or test card from the testing instructions on the submission page.",
      links: [],
    },
    {
      title: "Rebuy with one yes, then a decline",
      body: `On Rebuys the cleanser is due (staples show up ${numberWord(n.rebuyLeadDays)} days before they run out). Tap Yes: a customer-initiated charge on the saved method, with the PayPal order and capture IDs on the receipt. Send the same yes again: still one order, charged once. Then tap Move a week ahead, tick Make the next rebuy decline and tap Yes on another staple: PayPal answers INSTRUMENT_DECLINED, nothing is charged, and the card asks you to approve another card or PayPal account.`,
      links: [{ href: "/rebuys", label: "Open Rebuys" }],
    },
    {
      title: "See your decisions in AG Studio",
      body:
        "On a laptop, open Decisions: your verdicts (skips first), rebuys, shelf and budgets in one AG Studio workspace. Tap Yes on a rebuy to pay with the saved method; the shelf row updates in place. Tap Group my waits: our agent asks Studio's agents to build a table of what each wait is waiting for, in about 30 seconds. Customize opens the Studio editor.",
      links: [{ href: "/studio", label: "Open Decisions" }],
    },
    {
      title: "See the events and the number",
      body: `Webhook events lists what PayPal and Channel3 sent and whether each one verified. How often skip is right leads with the held-out result (${n.heldOutRight} of ${n.heldOutN} on products it had never seen) and lists every miss with the rule that fired; the ${n.devN}-product set the matching was developed on comes second and re-runs on the server.`,
      links: [
        { href: "/events", label: "Webhook events" },
        { href: "/proof", label: "How often skip is right", outline: true },
      ],
    },
  ];
}
