# Scheduled

The Scheduled screen keeps track of money that moves on a regular pattern: bills and subscriptions going out, salary coming in, and transfers between your own accounts. It shows what's coming up and when, and it can record each one in your accounts on its due date so your balances keep up without you typing anything in.

The screen used to be called Subscriptions; old `/subscriptions` links still work and open Scheduled.

## What a scheduled item is

A scheduled item describes something that repeats: its amount, how often it happens, and when it started. PiLedger works out every due date from there, so you never keep a list of dates by hand. Change the frequency and every future date moves with it.

Each item is one of three types:

| Type | What it does |
|---|---|
| **Payment** | Money leaving one account: rent, Netflix, car insurance. |
| **Income** | Money arriving in one account: salary, a pension, rent from a lodger. |
| **Transfer** | Money moving between two of your accounts, such as a monthly payment into savings. Both accounts must use the same currency. A transfer isn't spending, so it has no category. |

## Automatic or reminder

Each item is either **automatic** or a **reminder**.

- An **automatic** item posts itself. On each due date PiLedger adds the real transaction (or, for a transfer, both sides of it) to your accounts, so the balance is up to date the next time you look. Automatic items carry an **Auto** badge.
- A **reminder** never touches your balances. It still appears in the list and the calendar, and it still counts in each account's [projected balance](accounts.md#projected-balance). You record the payment yourself, or import it from a CSV.

When you add an item in the app, **Post automatically** starts switched on as soon as you choose an account (both accounts, for a transfer). It needs an open account to post to, so until you pick one the switch is off and greyed out, with a hint saying why. Switch it off for anything whose amount changes from month to month, such as an energy or phone bill: an automatic item always posts the same amount.

Editing an item keeps whatever it was set to. Subscriptions you added before this feature existed stay reminders until you switch them over. Through the [API](api-reference.md#scheduled-items), an item is only automatic if the request asks for it.

## Adding one

**+ Add scheduled item** asks for:

| Field | Notes |
|---|---|
| **Type** | Payment, Income or Transfer. |
| **Name** | What it is: "Netflix", "Salary", "Savings pot". |
| **Amount** | Always a positive number; the type says which way the money goes. |
| **Frequency** | Weekly, every 2 weeks, monthly, quarterly or annually. |
| **Category** | Optional. Matches the categories you use on transactions. Not shown for a transfer. |
| **Start date** | The anchor. Every due date is counted forward from it, so use the date of a real payment; a past date is fine. A monthly item that starts on the 29th, 30th or 31st falls on the last day of shorter months. |
| **End date** | Optional. Leave it empty for something ongoing; set it for something with a known end, like a 12-month contract. |
| **Paid from** / **Paid into** | The account a payment leaves or income arrives in. Optional for a reminder, needed to post automatically. |
| **From** / **To** | A transfer's two accounts. The To list only offers accounts in the same currency as the From account. |
| **Post automatically** | See [Automatic or reminder](#automatic-or-reminder). |
| **Notes** | Optional free text. |
| **Colour** | Tints the card's left edge and its calendar markers, which makes a busy month much easier to scan. |

## When automatic items post

Automatic items are posted once a day, shortly after midnight (00:05 on the server's clock by default; the server's owner can change the time or turn it off, see [Deployment](deployment.md#environment-variables)). PiLedger also catches up whenever the server starts, so if it was switched off on a due date, that payment is posted when it comes back.

A transaction posted this way:

- is dated on the due date, named after the item and filed under its category (a transfer with no category goes under "Transfer");
- has the note "Posted automatically";
- shows a repeat icon in transaction lists, meaning it came from a schedule;
- is an ordinary transaction otherwise. If this month's bill was £104 rather than £96, edit the amount; if the payment never happened, delete it.

**Nothing is back-filled.** An automatic item only posts due dates from the day auto-post was switched on, even if its start date is years earlier. Switching on auto-post for an old subscription won't create a pile of past transactions. The same applies when you change an automatic item's dates, frequency, type or accounts: it carries on from that day.

**A deleted transaction stays deleted.** PiLedger remembers each due date it has dealt with, so deleting a posted transaction never makes it come back on the next run.

**Closed accounts don't take postings.** If an automatic item's account is closed, the item is passed over and shows *Won't post: [account] is closed*. The item isn't paused: if the account is reopened, it catches up on the due dates it missed, just as it does after the server has been off.

## Post now, Skip and Undo

Each account's page has an **Upcoming** card listing what's due in the next 30 days (see [Accounts](accounts.md#upcoming)). Selecting a scheduled item there gives you three choices:

- **Post now** records it on the account straight away, dated today, with the note "Posted from schedule". That due date then counts as done, so an automatic item won't post it again when the day comes. This works for reminders too, as long as the item has an open account to post to.
- **Skip this one** marks that due date as skipped. Nothing posts for it, and it drops out of the account's projection. The next due date is unaffected.
- **Edit schedule** opens the item's form. Changes apply from now on.

After Post now or Skip, a confirmation appears with an **Undo** button. Undo removes anything that was posted, reverses its effect on the balance, and forgets that the date was dealt with. If the item is automatic and the date has already passed, it posts again on the next run.

## The two views

A switch at the top changes between them.

**List** shows every item as a card: its name (with a transfer icon for transfers), frequency, Auto badge if it has one, its account (or *From → To* for a transfer) and category. The amount carries its direction: `+` for income, `−` for a payment, no sign for a transfer. A pill says how close the next due date is: *Due today*, *Due tomorrow*, *Due in 5 days*. Anything inside a week is highlighted. A date that's already been posted or skipped is passed over, so the pill always points at the next one still to come. Amounts are shown in your base currency.

**Calendar** lays the same items out across a scrollable month grid, with a dot in the item's colour on each day it falls due. Once a date has been posted the dot becomes a tick; a skipped date shows as a faded ring. Tap a day to see what's on it, whether each one has been posted or skipped, and any item that can't post because its account is closed. This is the view for spotting clustering: three renewals landing the day before payday is the kind of thing a list hides and a calendar makes obvious.

## Ending or removing an item

To stop something, set an **end date**: no due dates after it are shown, projected or posted. Deleting removes the item outright.

Neither touches transactions that were already posted. Deleting an item also forgets which of its dates were posted or skipped, but the transactions themselves stay in your accounts.

The app has no pause switch. An item paused through the API (`active: false`) shows as *Paused*, disappears from the calendar and projections, and doesn't post. When it's resumed, an automatic item carries on from that day without back-filling.

## Importing a statement afterwards

When your bank's CSV arrives, it contains the same payments your automatic items already posted. The import spots them (same account and amount, dates within 3 days) and links each row to the existing transaction instead of adding it twice. Each match can be switched off in the preview. See [Payments already posted from a schedule](csv-import.md#payments-already-posted-from-a-schedule).

## Hiding the amounts

Scheduled amounts respect the **hide amounts** toggle in the header (the eye button), like every other figure in the app: useful if you're showing someone your calendar without showing them your outgoings.

## See also

- [Accounts](accounts.md): the account page, projected balances and the Upcoming card
- [Importing from CSV](csv-import.md): how imports match scheduled payments
- [Budgeting with Envelopes](budgeting.md): fixed groups are the natural home for regular bills
