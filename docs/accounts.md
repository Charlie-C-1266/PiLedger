# Accounts

Every account in PiLedger has its own page. It gathers everything about that one account in one place: what it holds now and how that has changed, where the balance is heading, what's due in the next month, and its latest transactions.

## Opening an account's page

You can reach an account's page from:

- its tile on the **Accounts** screen;
- the account name shown on a transaction;
- the search box in the header: search for the account's name.

The page lives at `/accounts/<id>`, so you can bookmark it. A deleted account shows *Account not found*.

## The header

The top of the page shows the account's provider mark (or, if no provider is recorded, a mark for its type), its name, and a chip saying where it stands: **Counts toward net worth**, **Set aside**, or **Closed**. Underneath is a short line with the provider, account type and interest rate.

Three buttons sit alongside:

- **Edit** opens the account's settings: a new balance, its colour and provider, whether it counts toward net worth, whether it's closed, and deleting it.
- **Transfer** moves money to another account, starting with this one as the source.
- **Add transaction** records a transaction on this account.

A closed account takes no new transactions or transfers, so it only shows **Edit**.

## Current balance

The balance is shown in the account's own currency. Beside it:

- **The change over the last 30 days**, for example *+£120.00 vs 30 days ago*. It compares today's balance with the balance the account had 30 days ago, so it's hidden for an account whose history only starts within the last 30 days.
- **Its share of your net worth**: *12.4% of your £25,000 net worth* for an account that adds to it, *Reduces your £25,000 net worth by £1,800* for a debt or an overdrawn account, or *Not counted in your £25,000 net worth* for a set-aside one. This uses your base currency, so it's hidden when the account's currency has no exchange rate, and when your net worth isn't above zero.

**Update balance** records what the account holds now, or held on an earlier date, with an optional note. Use it when the bank's figure and PiLedger's have drifted apart.

When the new balance differs from what the account held on that date, the difference appears in its transactions as a **Balance adjustment**, marked with a sliders icon and carrying your note, so you can always see when a balance was set by hand. For a credit card or loan, owing more shows as money out. Adjustments aren't counted as spending or money in or out. You can change an adjustment's note, and deleting it moves the balance back; to correct the amount, update the balance again. An account's first balance doesn't create one, and nor does entering the same balance again.

## Projected balance

Below the balance, PiLedger projects where the account is heading.

Four tiles show the projected balance **in 1, 3, 6 and 12 months**, each with its change from today. The tiles also pick the chart's range; the page opens on 3 months.

### What's included

A projection starts from the current balance and rolls it forward a day at a time, adding:

- **Every scheduled item that touches the account**: payments out of it, income into it, and transfers in either direction. Automatic items and reminders both count, because both describe money you expect to move. Due dates you've already posted or skipped are left out, as are items that have ended or are paused. See [Scheduled](scheduled.md).
- **Interest**, for current, savings and investment accounts with an interest rate. The rate is treated as an AER, and a month's interest is added on the 1st of each month: balance × ((1 + AER)^(1/12) − 1). A 4.5% AER therefore adds about 0.37% a month.

It never guesses one-off spending: the groceries and the coffees aren't in it. Think of it as where the balance goes if only the scheduled things happen.

For a loan or credit card, the projection shows the **amount owed**, and no interest is added.

### The chart

The chart draws the account's actual balance up to today as a solid line (the last 30 days for the 1- and 3-month views, 45 days for 6 months, 90 days for 12 months), then the projection as a dashed line up to the chosen horizon. On an account that isn't a debt, the lowest point is marked. Hover over it, drag along it on a touch screen, or use the arrow keys to read the balance on any day.

The note under the chart says:

- ***Goes overdrawn on 27 Jan.*** when an account that's in credit today is projected to drop below zero, giving the first day it does;
- otherwise, the **lowest point** in the chosen range and the day it's reached, for example *Lowest point in the next 3 months: £412.50 on 28 Nov*.

Neither note is shown for a loan or credit card. The note ends by saying what the projection includes, for example *Projections use this account's scheduled transactions and 4.50% interest, paid monthly. One-off spending isn't predicted.*

Closed accounts don't project.

## Upcoming

The **Upcoming** card lists what's due on the account today and over the next 30 days: each scheduled item and each projected interest credit, with its date, how often it repeats, its category (or, for a transfer, the account it goes to or comes from), the amount, and the balance once it lands. On an account that isn't a debt, a balance below zero is highlighted.

The card shows the first seven, says how many more there are, and ends with the net change over the 30 days. **Manage** opens the Scheduled screen.

Select a scheduled item to act on it. The window says whether it posts automatically or is a reminder, and offers:

- **Post now**: record it on the account today. An automatic item then won't post again on its due date; a reminder drops out of the projection.
- **Skip this one**: nothing posts for that due date, and it drops out of the projection.
- **Edit schedule**: change the amount, dates or account from now on.

Post now and Skip each show a confirmation with **Undo**. See [Post now, Skip and Undo](scheduled.md#post-now-skip-and-undo) for exactly what each one does. Interest credits are projections only, so they have nothing to post or skip.

Closed accounts have no Upcoming card.

## Recent transactions

The latest seven transactions on the account, with a count of how many there were in the last 30 days. Select one to edit it. A repeat icon marks a transaction that was posted from a schedule. **View all** opens the Transactions screen filtered to this account.

## Account details

A read-only summary: nickname, provider, account type, interest rate, currency, whether it counts toward net worth, when you started tracking it, and when its balance was last updated. Change them with **Edit**.

## Low-balance warnings

PiLedger watches each open current, savings and investment account's projection over today and the next 30 days. If the account is projected to drop below a set amount, its tile on the **Accounts** and **Overview** screens shows a chip: *Low by 14 Jan*, giving the first day it's projected to be under, or *Low now* if it already is.

The amount is zero unless you choose one. To be warned earlier, set **Warn me below** in the account's **Edit** window, for example £200 on a current account you don't want to run down. Clear the field to go back to warning only below zero.

The warning uses the same projection as the account page, so it only knows about scheduled transactions and interest, not one-off spending. Loans and credit cards hold the amount owed, so they have no warning. The account's own page doesn't show the chip, because the note under its chart already says when the balance runs low.

## Savings projections

The **Savings projections** window on the Overview shows each open savings account's projected balance in 1, 2 and 5 years. It uses the same projection as the account page: interest credited monthly, plus the scheduled transactions that touch the account, such as a monthly transfer in. So the 1-year figure there matches the 12-month figure on the account's page.

## See also

- [Scheduled](scheduled.md): recurring payments, income and transfers, and automatic posting
- [Importing from CSV](csv-import.md): bringing in a bank statement
