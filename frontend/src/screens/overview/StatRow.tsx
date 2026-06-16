import { useSummary } from "../../hooks/useSummary";
import { useTheme } from "../../theme/useTheme";
import { fmt } from "../../lib/currency";
import StatCard from "../../components/StatCard";

/**
 * The Assets / Debts / Savings-rate stat cards (plus a "Set aside" card when the
 * user has excluded accounts). Renders placeholder cards while the summary loads
 * so no misleading £0.00 / 0% flashes. The wrapping grid — and its widen-to-four
 * layout — is owned by the parent StaggerItem in Overview.
 */
export default function StatRow() {
  const { theme } = useTheme();
  const { data: summary, isPending } = useSummary();
  const currency = summary?.base_currency ?? "GBP";
  const setAside = summary?.set_aside ?? 0;

  if (isPending) {
    return (
      <>
        <StatCard label="" value="" loading />
        <StatCard label="" value="" loading />
        <StatCard label="" value="" loading />
      </>
    );
  }

  return (
    <>
      <StatCard
        label="Assets"
        value={fmt(summary?.assets ?? 0, currency)}
        color={theme.up}
      />
      <StatCard
        label="Debts"
        value={fmt(Math.abs(summary?.debts ?? 0), currency)}
        color={theme.down}
      />
      <StatCard
        label="Savings rate"
        value={`${(summary?.savings_rate ?? 0).toFixed(0)}%`}
        color={theme.accent}
      />
      {setAside !== 0 && (
        <StatCard label="Set aside" value={fmt(setAside, currency)} />
      )}
    </>
  );
}
