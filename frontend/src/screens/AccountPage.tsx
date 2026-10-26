import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { useAccounts } from "../hooks/useAccounts";
import { useAccountActivity } from "../hooks/useAccountActivity";
import { useRates } from "../hooks/useRates";
import { useSummary } from "../hooks/useSummary";
import { useTransactions } from "../hooks/useTransactions";
import { useMoney } from "../privacy/useMoney";
import { currencySymbol } from "../lib/currency";
import { initialsFrom, resolveInstitution } from "../lib/institutions";
import { accountTypeLabel, accountTypeLine } from "../lib/accountTypes";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import AccountTile from "../components/AccountTile";
import AddModal from "../components/AddModal";
import DeltaPill from "../components/DeltaPill";
import DetailList, { type DetailItem } from "../components/DetailList";
import EditAccountModal from "../components/EditAccountModal";
import InstitutionMark from "../components/InstitutionMark";
import NetWorthChip from "../components/NetWorthChip";
import Skeleton from "../components/Skeleton";
import TextLink from "../components/TextLink";
import TransferModal from "../components/TransferModal";
import TxnRow from "../components/TxnRow";
import UpdateBalanceModal from "../components/UpdateBalanceModal";
import { ChevronLeftIcon, PlusIcon, TransferIcon } from "../components/icons";
import {
  formatLongDate,
  formatUpdated,
  netWorthShare,
  rateLabel,
  type NetWorthShare,
} from "./account/accountModel";
import type { Account, Transaction } from "../types";
import styles from "./AccountPage.module.css";

const RECENT_LIMIT = 7;
const ACTIVITY_DAYS = 30;

type ModalKind = "edit" | "transfer" | "add" | "balance";

function BackLink() {
  return (
    <Link to="/accounts" className={styles.back}>
      <ChevronLeftIcon className={styles.backIcon} aria-hidden="true" />
      Accounts
    </Link>
  );
}

/**
 * `/accounts/:id` — everything about one account on one screen. This outer
 * part resolves the id against the account list; the body below owns the
 * account-specific queries, so they only run for an account the user has.
 */
export default function AccountPage() {
  const { id } = useParams();
  const accountId = Number(id);
  const { data: accounts, isPending } = useAccounts();
  const account = Number.isInteger(accountId)
    ? accounts?.find((a) => a.id === accountId)
    : undefined;

  if (isPending && Number.isInteger(accountId)) return <AccountPageSkeleton />;
  if (!account) return <AccountNotFound />;
  return <AccountPageBody account={account} />;
}

function AccountNotFound() {
  return (
    <PageStagger className={styles.page}>
      <StaggerItem>
        <BackLink />
      </StaggerItem>
      <StaggerItem className={`${styles.card} ${styles.notFound}`}>
        <h1 className={styles.notFoundTitle}>Account not found</h1>
        <p className={styles.notFoundText}>
          It may have been deleted, or the link may be wrong.
        </p>
        <Link to="/accounts" className={styles.addPill}>
          Back to Accounts
        </Link>
      </StaggerItem>
    </PageStagger>
  );
}

function AccountPageSkeleton() {
  return (
    <div className={styles.page} aria-busy="true">
      <BackLink />
      <span className="sr-only">Loading account</span>
      <div className={styles.head}>
        <div className={styles.headId}>
          <Skeleton width={48} height={48} radius={13} />
          <div className={styles.titles}>
            <Skeleton width={200} height={28} radius={8} />
            <Skeleton width={260} height={14} radius={6} style={{ marginTop: 8 }} />
          </div>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.balanceCard}`}>
          <Skeleton width={120} height={11} radius={4} />
          <Skeleton width={240} height={46} radius={10} style={{ margin: "10px 0" }} />
          <Skeleton width={300} height={22} radius={999} />
        </div>
        <div className={`${styles.card} ${styles.recentCard}`}>
          <Skeleton width={180} height={18} radius={6} />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={40} radius={10} style={{ marginTop: 16 }} />
          ))}
        </div>
        <div className={styles.side}>
          <div className={styles.card}>
            <Skeleton width={150} height={18} radius={6} />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={14} radius={6} style={{ marginTop: 18 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function shareText(
  share: NetWorthShare,
  fmt: (value: number, currency?: string) => string,
  base: string,
): string {
  const total = fmt(share.total, base);
  switch (share.kind) {
    case "share":
      return `${share.percent.toFixed(1)}% of your ${total} net worth`;
    case "reduces":
      return `Reduces your ${total} net worth by ${fmt(share.amount, base)}`;
    case "excluded":
      return `Not counted in your ${total} net worth`;
  }
}

function AccountPageBody({ account }: { account: Account }) {
  const { fmt } = useMoney();
  const navigate = useNavigate();
  const { data: summary, isPending: summaryPending } = useSummary();
  const { data: rates, isPending: ratesPending } = useRates();
  const { data: activity, isPending: activityPending } = useAccountActivity(
    account.id,
    ACTIVITY_DAYS,
  );
  const { data: transactions, isPending: txnsPending } = useTransactions({
    account: account.id,
    per_page: RECENT_LIMIT,
  });
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);

  const institution = resolveInstitution(account);
  const typeLabel = accountTypeLabel(account.type);
  // No provider recorded: the header mark falls back to the account type, in
  // the account's own colour.
  const headerMark = institution ?? {
    name: typeLabel,
    color: account.color || "#6366f1",
    mark: initialsFrom(typeLabel),
  };
  const rate = rateLabel(account.interest_rate);
  const meta = [institution?.name, accountTypeLine(account), rate]
    .filter(Boolean)
    .join(" · ");

  const balance = account.current_balance ?? 0;
  const change = activity?.change ?? null;
  const base = summary?.base_currency ?? "GBP";
  const share = netWorthShare(account, summary?.total, rates);
  const figuresPending = activityPending || summaryPending || ratesPending;

  const recent = transactions ?? [];
  const count = activity?.count;

  const details: DetailItem[] = [
    { label: "Nickname", value: account.name },
    institution
      ? {
          label: "Provider",
          value: institution.name,
          mark: <InstitutionMark institution={institution} size={18} />,
        }
      : { label: "Provider", value: "Not recorded" },
    { label: "Account type", value: accountTypeLine(account) },
    { label: "Interest rate", value: rate ?? "None" },
    {
      label: "Currency",
      value: `${account.currency} · ${currencySymbol(account.currency).trim()}`,
    },
    account.counts_to_net_worth
      ? {
          label: "Net worth",
          value: "Included",
          note: "Included in your Overview headline and trend.",
        }
      : {
          label: "Net worth",
          value: "Set aside",
          note: "Kept out of your Overview headline and trend.",
        },
    { label: "Tracking since", value: formatLongDate(account.created_at) },
    {
      label: "Balance updated",
      value: account.last_updated ? formatUpdated(account.last_updated) : "Not recorded",
    },
  ];

  const close = () => setModal(null);

  return (
    <PageStagger className={styles.page}>
      <StaggerItem>
        <BackLink />
      </StaggerItem>

      <StaggerItem className={styles.head}>
        <div className={styles.headId}>
          <InstitutionMark institution={headerMark} size={48} />
          <div className={styles.titles}>
            <div className={styles.titleRow}>
              <h1 className={styles.name}>{account.name}</h1>
              <NetWorthChip
                countsToNetWorth={account.counts_to_net_worth}
                closed={account.closed}
              />
            </div>
            <div className={styles.meta}>{meta}</div>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => setModal("edit")}
          >
            Edit
          </button>
          {/* A closed account takes no new transactions or transfers. */}
          {!account.closed && (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setModal("transfer")}
              >
                <TransferIcon className={styles.btnIcon} aria-hidden="true" />
                Transfer
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => setModal("add")}
              >
                <PlusIcon className={styles.btnIcon} aria-hidden="true" />
                Add transaction
              </button>
            </>
          )}
        </div>
      </StaggerItem>

      <div className={styles.grid}>
        <StaggerItem className={`${styles.card} ${styles.balanceCard}`}>
          <section aria-labelledby="account-balance-label">
            <div className={styles.balanceTop}>
              <div className={styles.balanceFigures}>
                <div className={styles.micro} id="account-balance-label">
                  Current balance
                </div>
                <div className={styles.heroValue}>{fmt(balance, account.currency)}</div>
                {figuresPending ? (
                  <Skeleton width={280} height={22} radius={999} />
                ) : (
                  <div className={styles.balanceMeta}>
                    {change != null && (
                      <>
                        <DeltaPill direction={change >= 0 ? "up" : "down"}>
                          {change >= 0 ? "+" : "−"}
                          {fmt(Math.abs(change), account.currency)}
                        </DeltaPill>
                        <span className={styles.metaMute}>vs 30 days ago</span>
                      </>
                    )}
                    {share && (
                      <>
                        {change != null && (
                          <span
                            className={`${styles.metaMute} ${styles.sep}`}
                            aria-hidden="true"
                          >
                            ·
                          </span>
                        )}
                        <span className={styles.metaMute}>
                          {shareText(share, fmt, base)}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={styles.addPill}
                onClick={() => setModal("balance")}
              >
                Update balance
              </button>
            </div>
          </section>
        </StaggerItem>

        <StaggerItem className={`${styles.card} ${styles.recentCard}`}>
          <section aria-labelledby="account-recent-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle} id="account-recent-title">
                  Recent transactions
                </h2>
                <div className={styles.sectionSub}>
                  Last 30 days
                  {count != null &&
                    ` · ${count} transaction${count === 1 ? "" : "s"}`}
                </div>
              </div>
              {recent.length > 0 && (
                <TextLink
                  to={`/transactions?account=${account.id}`}
                  aria-label={`View all transactions for ${account.name}`}
                >
                  View all
                </TextLink>
              )}
            </div>
            <div className={styles.txnList}>
              {txnsPending ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.txnDivider}>
                    <Skeleton height={40} radius={10} style={{ margin: "12px 0" }} />
                  </div>
                ))
              ) : recent.length === 0 ? (
                <div className={styles.empty}>
                  <p>No transactions yet</p>
                  {!account.closed && (
                    <button
                      type="button"
                      className={styles.addPill}
                      onClick={() => setModal("add")}
                    >
                      Add transaction
                    </button>
                  )}
                </div>
              ) : (
                recent.map((txn) => (
                  <div key={txn.id} className={styles.txnDivider}>
                    <TxnRow
                      txn={txn}
                      currency={account.currency}
                      onClick={() => setEditingTxn(txn)}
                    />
                  </div>
                ))
              )}
            </div>
          </section>
        </StaggerItem>

        <StaggerItem className={styles.side}>
          {/* The header already names the account; the tile repeats it as a
              picture, so it's hidden from screen readers. */}
          <div className={styles.wideTile} aria-hidden="true">
            <AccountTile account={account} wide badge />
          </div>
          <section className={styles.card} aria-labelledby="account-details-title">
            <div className={styles.sectionHeader} style={{ marginBottom: 6 }}>
              <h2 className={styles.sectionTitle} id="account-details-title">
                Account details
              </h2>
            </div>
            <DetailList items={details} />
          </section>
        </StaggerItem>
      </div>

      <AnimatePresence>
        {modal === "edit" && (
          <EditAccountModal
            key="edit"
            account={account}
            onClose={close}
            onDeleted={() => navigate("/accounts")}
          />
        )}
        {modal === "transfer" && (
          <TransferModal key="transfer" fromAccountId={account.id} onClose={close} />
        )}
        {modal === "add" && (
          <AddModal key="add" accountId={account.id} onClose={close} />
        )}
        {modal === "balance" && (
          <UpdateBalanceModal key="balance" account={account} onClose={close} />
        )}
        {editingTxn && (
          <AddModal
            key="edit-txn"
            accountId={editingTxn.account_id}
            transaction={editingTxn}
            onClose={() => setEditingTxn(null)}
          />
        )}
      </AnimatePresence>
    </PageStagger>
  );
}
