import { useEffect, useRef } from "react";
import { bootstrapSupabaseFromSession, getSupabaseClient } from "../src/lib/supabase";

export type SignalTarget = "execution" | "errors";

const OVERVIEW_REALTIME_TABLES: Array<{ table: string; target: SignalTarget }> = [
  { table: "agentsam_workflow_runs", target: "execution" },
  { table: "agentsam_error_events", target: "errors" },
];

type UseRealtimeSignalOpts = {
  onSignal: (target: SignalTarget) => void;
  supabaseUserId: string | null;
  enabled?: boolean;
};

/**
 * Free-tier Supabase: one channel, two postgres_changes handlers (workflow runs + error inbox).
 * Dashboard bundle refresh is throttled in the parent (60s); signals only schedule a
 * bundle refetch when that gate allows — not every postgres_changes row.
 */
export function useRealtimeSignal({ onSignal, supabaseUserId, enabled = true }: UseRealtimeSignalOpts) {
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    if (!enabled || !supabaseUserId) return;

    let cancelled = false;
    let removeChannel: (() => void) | null = null;

    void (async () => {
      const client = getSupabaseClient() ?? (await bootstrapSupabaseFromSession());
      if (cancelled || !client) return;

      let channel = client.channel(`dashboard-overview-${supabaseUserId}`);
      for (const { table, target } of OVERVIEW_REALTIME_TABLES) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => {
            onSignalRef.current(target);
          },
        );
      }

      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[useRealtimeSignal] channel error");
        }
      });

      removeChannel = () => {
        void client.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [supabaseUserId, enabled]);
}
