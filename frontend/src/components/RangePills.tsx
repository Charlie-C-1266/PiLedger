import type { RangeKey } from "../types";
import SegmentedControl from "./SegmentedControl";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "90D", label: "90D" },
  { value: "1Y", label: "1Y" },
];

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
}

/** Net-worth trend range picker — a thin typed wrapper over SegmentedControl. */
export default function RangePills({ value, onChange }: Props) {
  return (
    <SegmentedControl
      options={RANGE_OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Time range"
    />
  );
}
