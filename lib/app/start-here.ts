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
      title: "Hand it your week",
      body: "On the week page, tap Use the sample week: four posts are checked at once, and this week's order lists what needs paying: the peptide serum and the cleanser that's running out. The first item goes through PayPal checkout: tick save and pay with the login or card in the testing instructions on the submission page. Back on the week, one yes pays the rest.",
      more: "The two skips show what they kept, and the retinol's price watch starts with the yes. Each item is its own PayPal payment, shown with its PayPal order ID and receipt. Tap yes again and nothing is charged twice.",
      links: [{ href: "/week", label: "Open the week" }],
    },
    {
      title: "Open the sunscreen skip",
      body: "On Check, open the sunscreen post: skip, you own one that does the same job.",
      more: "The sample week has two skips, three waits, a buy and a cleanser due for a reorder. The week page hands over the four posts with screenshots. See why shows the rule, the shelf item and the store's cited return policy, and the same product at other stores. Four sample posts are on Check too, or upload your own screenshot or paste a store link.",
      links: [{ href: "/check", label: "Open Check" }],
      sampleWeek: true,
    },
    {
      title: "Reorder with one yes, then a decline",
      body: "On Reorders, move a week ahead: the next staples come due. Tap Yes on one to pay with the saved method. Then tick Make the next reorder decline and tap Yes on the other.",
      more: `Staples show up ${numberWord(n.rebuyLeadDays)} days before they run out. The receipt shows the PayPal order and capture IDs. Send the same yes again: still one order, charged once. On the decline, PayPal answers INSTRUMENT_DECLINED, nothing is charged, and LookLook asks you to pay with another card or PayPal account. The retinol's watch is on Reorders too: Try a price drop shows how a drop arrives, and with this month's skincare budget spent it waits for next month's.`,
      links: [{ href: "/rebuys", label: "Open Reorders" }],
    },
    {
      title: "See your decisions in AG Studio",
      body: "On a laptop, open the dashboard: checks, reorders, shelf and budgets together. Tap Group my waits and Studio's agents build a table of what each wait is waiting for.",
      more: "Tap Yes on a reorder there to pay with the saved method. The shelf row updates in place. The table takes about 30 seconds. Customize opens the Studio editor.",
      links: [{ href: "/studio", label: "Open the dashboard" }],
    },
    {
      title: "See the webhooks and the accuracy test",
      body: "Webhook events lists what PayPal and Channel3 sent and whether each was verified. The accuracy test lists every miss.",
      more: `It leads with ${n.heldOutRight} of ${n.heldOutN} on products the app had never seen, then the ${n.devN} products the matching was built on, which you can re-run on the server.`,
      links: [
        { href: "/events", label: "Webhook events" },
        { href: "/proof", label: "Accuracy test", outline: true },
      ],
    },
  ];
}
