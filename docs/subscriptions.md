# Subscriptions

The Subscriptions screen keeps track of the payments that repeat — streaming services, insurance, gym membership, standing orders — so a renewal never arrives as a surprise. It answers two questions: *what's coming up*, and *when*.

## What a subscription is (and isn't)

A subscription in PiLedger is a **reminder**, not an automatic payment. Adding one records the shape of a recurring charge — its name, amount, how often it repeats, and when it started — and PiLedger works out every future occurrence from there.

It does **not** post transactions to your accounts. When the payment actually leaves your bank you log it the usual way (or import it from a CSV), exactly as you would today. The subscription's job is to tell you it's coming, and to show you what your recurring commitments add up to.

That distinction matters for the **account** field too: linking a subscription to an account is a label saying "this one comes out of my Monzo current account". It doesn't move money, and the account's balance is unaffected until a real transaction lands.

## Adding one

**+ Add subscription** asks for:

| Field | Notes |
|---|---|
| **Name** | What it is — "Netflix", "Car insurance". |
| **Amount** | What leaves your account each time. Always a positive number. |
| **Frequency** | Weekly, biweekly, monthly, quarterly, or annual. |
| **Start date** | The anchor. Every future occurrence is counted forward from this date, so use the date of a real payment — past is fine. |
| **End date** | Optional. Leave it empty for an ongoing subscription; set it for something with a known end, like a 12-month contract. |
| **Category** | Optional. Matches the categories you use on transactions. |
| **Account** | Optional label for where the payment comes from. |
| **Colour** | Optional. Tints the card's left edge and its calendar markers, which makes a busy month much easier to scan. |
| **Notes** | Optional free text. |

Because occurrences are derived from the start date and frequency, you never maintain a list of dates by hand — change the frequency and every future date moves with it.

## The two views

A segmented control at the top switches between them.

**List** shows every subscription as a card, each with a pill telling you how close the next payment is — *Due today*, *Due tomorrow*, *Due in 5 days*. Anything inside a week is highlighted so it stands out from the rest. Amounts are shown in your base currency.

**Calendar** lays the same information out across a scrollable month grid, with each subscription marked on the days it falls due. This is the view for spotting clustering — three renewals landing the day before payday is the kind of thing a list hides and a calendar makes obvious.

## Pausing and removing

Editing a subscription lets you mark it **inactive**. A paused subscription keeps all its details and stops generating occurrences — its card reads *Paused* and it disappears from the calendar. Use this for something you've cancelled but might resume, or a seasonal payment.

Deleting removes it outright. Neither pausing nor deleting touches any transactions you've already logged.

## Hiding the amounts

Subscription amounts respect the **hide amounts** toggle in the header (the eye button), like every other figure in the app — useful if you're showing someone your renewal calendar without showing them your outgoings.

## See also

- [Getting Started](getting-started.md) — accounts, transactions, and the basics
- [Budgeting with Envelopes](budgeting.md) — fixed groups are the natural home for subscription spending
