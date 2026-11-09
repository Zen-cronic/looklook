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
  /** What to do, in about two lines. */
  body: string;
  /** The detail, behind "More". */
  more?: string;
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
      body: "The week has two skips, four waits, a buy and a cleanser due for a rebuy. Open the sunscreen: skip, you own one already.",
      more: "On Check, the newest entry is the sunscreen post. Open See why for the rule, the shelf item and the store's cited return policy, and see the same product at other stores.",
      links: [{ href: "/check", label: "Open Check" }],
      sampleWeek: true,
    },
    {
      title: "Wait for a lower price",
      body: "Open the retinol (a wait for a lower price) and tap Watch for a drop. Then, on Rebuys, tap Send a test price drop.",
      more: "Channel3 sets a real price alert at the target. The test drop runs a price event through the same handler, and the retinol asks for your yes. Do this before step 3: buying the serum spends this month's skincare budget, and the retinol then waits for next month's budget instead.",
      links: [{ href: "/rebuys", label: "Open Rebuys" }],
    },
    {
      title: "Buy once and save PayPal for rebuys",
      body: "Open the peptide serum, tap Buy for $32.00 with PayPal and tick the save box. Pay with the login or card in the testing instructions on the submission page.",
      more: "Checkout shows what saving agrees to and a cap per rebuy. Pay with the PayPal button or the card fields.",
      links: [{ href: "/check", label: "Open Check" }],
    },
    {
      title: "Rebuy with one yes, then a decline",
      body: "On Rebuys, tap Yes on the cleanser to pay with the saved method. Then move a week ahead, tick Make the next rebuy decline and tap Yes again.",
      more: `Staples show up ${numberWord(n.rebuyLeadDays)} days before they run out. The receipt shows the PayPal order and capture IDs. Send the same yes again: still one order, charged once. On the decline, PayPal answers INSTRUMENT_DECLINED, nothing is charged, and the card asks you to approve another card or PayPal account.`,
      links: [{ href: "/rebuys", label: "Open Rebuys" }],
    },
    {
      title: "See your decisions in AG Studio",
      body: "On a laptop, open Decisions: checks, rebuys, shelf and budgets together. Tap Group my waits and Studio's agents build a table of what each wait is waiting for.",
      more: "Tap Yes on a rebuy there to pay with the saved method; the shelf row updates in place. The table takes about 30 seconds. Customize opens the Studio editor.",
      links: [{ href: "/studio", label: "Open Decisions" }],
    },
    {
      title: "See the webhooks and the accuracy test",
      body: "Webhook events lists what PayPal and Channel3 sent and whether each was verified. How often skip is right lists every miss.",
      more: `It leads with ${n.heldOutRight} of ${n.heldOutN} on products the app had never seen, then the ${n.devN} products the matching was built on, which you can re-run on the server.`,
      links: [
        { href: "/events", label: "Webhook events" },
        { href: "/proof", label: "How often skip is right", outline: true },
      ],
    },
  ];
}
