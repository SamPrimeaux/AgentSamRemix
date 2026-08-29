import { Link } from "react-router-dom";
import type { DashboardBundle } from "../types";
import { T, fmt } from "../constants";
import { Skel } from "../primitives";

export function MtdSpendStrip({
  bundle,
  loading,
}: {
  bundle: DashboardBundle | null;
  loading: boolean;
}) {
  const live = bundle?.ok === true && bundle.kpis != null;
  const mtd = live ? Number(bundle.kpis?.mtd_spend_usd) || 0 : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 10,
        marginBottom: 10,
        fontFamily: T.font,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: T.muted,
        }}
      >
        MTD Spend
      </span>
      {loading ? (
        <Skel h={20} w={72} />
      ) : (
        <Link
          to="/dashboard/finance"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.accent,
            textDecoration: "none",
            letterSpacing: "-0.02em",
          }}
          title="Open Finance dashboard"
        >
          {live ? fmt.usd(mtd) : "--"}
        </Link>
      )}
    </div>
  );
}
