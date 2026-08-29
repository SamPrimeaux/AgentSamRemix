import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { motion } from "framer-motion";

/**
 * Agent Sam MCP Authorization Screen
 * Fully styled TSX mockup. Wiring intentionally left to parent route.
 *
 * No provider/workspace is hardcoded. Pass client + workspace data from the
 * authorization request/session that initiated the MCP consent flow.
 */

type AuthState = "idle" | "loading" | "success" | "error" | "declined";
type PermissionTone = "read" | "write" | "guarded";

type Workspace = {
  id: string;
  name: string;
  subtitle?: string;
};

type Permission = {
  label: string;
  tone: PermissionTone;
};

type ClientInfo = {
  name: string;
  domain?: string;
  logoUrl?: string;
  initials?: string;
  typeLabel?: string;
};

type McpAuthorizationScreenProps = {
  client?: ClientInfo;
  workspaces?: Workspace[];
  permissions?: Permission[];
  productName?: string;
  brandName?: string;
  successMode?: "cli" | "dashboard";
  onAuthorize?: (payload: { workspaceId: string }) => Promise<void> | void;
  onDecline?: () => Promise<void> | void;
  onReturn?: () => void;
};

const DEFAULT_PERMISSIONS: Permission[] = [
  { label: "Read access to workspace metadata.", tone: "read" },
  { label: "Read access to available MCP tools and capabilities.", tone: "read" },
  { label: "Read access to logs, tool status, and integration health.", tone: "read" },
  { label: "Read and Write access to approved development workflows.", tone: "write" },
  { label: "No direct access to hidden secrets unless separately approved.", tone: "guarded" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getInitials(client?: ClientInfo) {
  if (client?.initials) return client.initials.slice(0, 2).toUpperCase();
  if (!client?.name) return "AI";

  return client.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function BrandMark({ brandName = "InnerAnimalMedia", productName = "Agent Sam MCP" }: { brandName?: string; productName?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-7 w-7 overflow-hidden rounded-[10px] border border-white/10 bg-white/[0.04] shadow-[0_0_24px_rgba(90,125,247,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(160,195,255,0.7),transparent_32%),linear-gradient(135deg,rgba(90,125,247,0.9),rgba(50,215,180,0.42))]" />
        <div className="absolute left-[10px] top-[5px] h-[18px] w-2 rotate-[22deg] rounded-[4px] bg-[#0d0d10]/80" />
      </div>
      <div>
        <div className="text-[13px] font-semibold tracking-[-0.01em] text-white">{brandName}</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.17em] text-white/42">{productName}</div>
      </div>
    </div>
  );
}

function ClientAvatar({ client }: { client?: ClientInfo }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {client?.logoUrl ? (
        <img src={client.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[15px] font-semibold text-white/80">{getInitials(client)}</span>
      )}
    </div>
  );
}

function PermissionRow({ label, tone }: Permission) {
  const prefix = label.startsWith("Read and Write")
    ? "Read and Write"
    : label.startsWith("Read")
      ? "Read"
      : "Protected";

  const rest = label
    .replace(/^Read and Write\s?/, "")
    .replace(/^Read\s?/, "")
    .replace(/^No direct access\s?/, "No direct access ");

  return (
    <div className="grid grid-cols-[20px_1fr] gap-2.5 border-t border-white/[0.07] px-2 py-2.5 first:border-t-0">
      <div
        className={cx(
          "mt-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border",
          tone === "write" && "border-blue-300/30 bg-blue-400/10 text-blue-200",
          tone === "guarded" && "border-amber-300/35 bg-amber-400/10 text-amber-200",
          tone === "read" && "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
        )}
      >
        <Check className="h-3 w-3" strokeWidth={2.4} />
      </div>
      <p className="text-[13px] leading-5 text-white/70">
        <span className="font-semibold text-white/88">{prefix}</span> {rest}
      </p>
    </div>
  );
}

function WorkspaceSelect({
  workspaces,
  selected,
  setSelected,
  showError,
}: {
  workspaces: Workspace[];
  selected: string;
  setSelected: (value: string) => void;
  showError: boolean;
}) {
  const hasWorkspaces = workspaces.length > 0;

  return (
    <div className="space-y-2">
      <label className="text-[12px] font-medium text-white/84">Workspace to grant API access to</label>
      <div className="relative">
        <select
          value={selected}
          disabled={!hasWorkspaces}
          onChange={(event) => setSelected(event.target.value)}
          className={cx(
            "h-10 w-full appearance-none rounded-xl border bg-white/[0.035] px-3.5 pr-10 text-[13px] text-white/84 outline-none backdrop-blur-xl transition",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
            !hasWorkspaces && "cursor-not-allowed opacity-55",
            showError
              ? "border-red-300/45 ring-4 ring-red-500/10"
              : "border-white/[0.11] hover:border-white/[0.18] focus:border-blue-300/55 focus:ring-4 focus:ring-blue-500/10",
          )}
        >
          <option value="" className="bg-[#111116] text-white/70">
            {hasWorkspaces ? "Select a workspace" : "No eligible workspaces available"}
          </option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id} className="bg-[#111116] text-white">
              {workspace.name}{workspace.subtitle ? ` — ${workspace.subtitle}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/42" />
      </div>
      {showError ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-100/90"
        >
          Select a workspace before continuing.
        </motion.div>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  loading,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3.5 text-[12px] font-semibold text-[#f4f7ff] transition",
        "border border-blue-200/40 bg-[linear-gradient(180deg,rgba(164,199,255,0.38),rgba(90,125,247,0.22)),rgba(90,125,247,0.20)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_34px_rgba(90,125,247,0.22),0_0_18px_rgba(90,125,247,0.15)] backdrop-blur-2xl",
        "hover:border-blue-100/70 hover:bg-[linear-gradient(180deg,rgba(180,210,255,0.46),rgba(90,125,247,0.28)),rgba(90,125,247,0.26)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.045] px-3.5 text-[12px] font-semibold text-white/74 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl transition hover:border-white/[0.2] hover:bg-white/[0.075] hover:text-white/92"
    >
      {children}
    </button>
  );
}

function StatusCard({
  state,
  onReset,
  brandName,
  productName,
  successMode = "cli",
}: {
  state: Extract<AuthState, "success" | "error" | "declined">;
  onReset: () => void;
  brandName?: string;
  productName?: string;
  successMode?: "cli" | "dashboard";
}) {
  const config = {
    success: {
      title: "Authorization complete",
      body:
        successMode === "dashboard"
          ? "You have successfully completed your authorization. Returning you to your dashboard settings."
          : "You have successfully completed your authorization. You can close this window and return to the CLI.",
      action: successMode === "dashboard" ? "Return to dashboard" : "Open integrations",
      icon: ShieldCheck,
      tone: "blue",
    },
    error: {
      title: "Authorization could not be verified",
      body: "For your security, this request was not completed because the authorization state could not be verified.",
      action: "Return to integrations",
      icon: AlertTriangle,
      tone: "amber",
    },
    declined: {
      title: "Authorization declined",
      body: "No access was granted. You can safely close this window or return to integrations to try again.",
      action: "Return to integrations",
      icon: X,
      tone: "red",
    },
  }[state];

  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="w-full max-w-[500px] overflow-hidden rounded-3xl border border-white/[0.11] bg-[#111116]/78 shadow-[0_28px_84px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl"
    >
      <div className="border-b border-white/[0.08] px-5 py-4">
        <BrandMark brandName={brandName} productName={productName} />
      </div>
      <div className="p-7 text-center">
        <div
          className={cx(
            "mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
            config.tone === "blue" && "border-blue-200/35 bg-blue-400/12 text-blue-100",
            config.tone === "amber" && "border-amber-200/35 bg-amber-400/12 text-amber-100",
            config.tone === "red" && "border-red-200/35 bg-red-400/12 text-red-100",
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.03em] text-white">{config.title}</h1>
        <p className="mx-auto mt-2.5 max-w-[380px] text-[14px] leading-6 text-white/62">{config.body}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <PrimaryButton onClick={onReset}>
            {config.action}
            <ArrowRight className="h-3.5 w-3.5" />
          </PrimaryButton>
          {state !== "success" ? <SecondaryButton onClick={onReset}>Try Again</SecondaryButton> : null}
        </div>
      </div>
    </motion.div>
  );
}

export default function McpAuthorizationScreen({
  client,
  workspaces = [],
  permissions = DEFAULT_PERMISSIONS,
  productName = "Agent Sam MCP",
  brandName = "InnerAnimalMedia",
  successMode = "cli",
  onAuthorize,
  onDecline,
  onReturn,
}: McpAuthorizationScreenProps) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [state, setState] = useState<AuthState>("idle");
  const [showError, setShowError] = useState(false);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId),
    [workspaceId, workspaces],
  );

  async function authorize() {
    if (!workspaceId) {
      setShowError(true);
      return;
    }

    try {
      setShowError(false);
      setState("loading");
      await onAuthorize?.({ workspaceId });
      setState("success");
    } catch {
      setState("error");
    }
  }

  async function decline() {
    await onDecline?.();
    setState("declined");
  }

  function reset() {
    onReturn?.();
    setState("idle");
    setShowError(false);
  }

  const clientName = client?.name || "The requesting application";
  const clientDomain = client?.domain;
  const clientTypeLabel = client?.typeLabel || "MCP client";

  return (
    <main className="min-h-screen overflow-hidden bg-[#0d0d10] text-white antialiased">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-24rem] h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-blue-500/14 blur-3xl" />
        <div className="absolute bottom-[-18rem] right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-cyan-400/9 blur-3xl" />
        <div className="absolute bottom-[-16rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-indigo-500/11 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.024)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.024)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(circle_at_50%_20%,black,transparent_70%)]" />
      </div>

      <header className="relative z-10 border-b border-white/[0.07] bg-[#0d0d10]/72 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:px-8">
          <BrandMark brandName={brandName} productName={productName} />
          <div className="hidden items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-[11px] font-medium text-white/52 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-200/80" />
            Secure authorization
          </div>
        </div>
      </header>

      <section className="relative z-10 flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-7 sm:px-6 lg:px-8">
        {state === "success" || state === "error" || state === "declined" ? (
          <StatusCard
            state={state}
            onReset={reset}
            brandName={brandName}
            productName={productName}
            successMode={successMode}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.26, ease: "easeOut" }}
            className="w-full max-w-[620px] overflow-hidden rounded-3xl border border-white/[0.11] bg-[#111116]/78 shadow-[0_30px_96px_rgba(0,0,0,0.54),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl"
          >
            <div className="border-b border-white/[0.08] px-5 py-4 sm:px-6">
              <h1 className="text-[16px] font-medium tracking-[-0.02em] text-white/92">Authorize API access for {productName}</h1>
            </div>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="rounded-2xl border border-amber-300/18 bg-[linear-gradient(180deg,rgba(124,78,12,0.32),rgba(70,43,6,0.30))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="grid grid-cols-[36px_1fr] gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-300/12 text-amber-100">
                    <TerminalSquare className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h2 className="text-[13px] font-semibold text-white/90">MCP Client Connection</h2>
                    <p className="mt-1 text-[12.5px] leading-5 text-amber-50/68">
                      This MCP client is requesting access to connect AI applications with your available tools,
                      data, and workflows. Please make sure you trust this application before granting access.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-[44px_1fr] gap-3.5">
                <ClientAvatar client={client} />
                <div className="min-w-0 pt-0.5">
                  <p className="text-[14px] leading-6 text-white/82">
                    <span className="font-semibold text-white">{clientName}</span>
                    {clientDomain ? <span className="text-white/52"> {clientDomain}</span> : null} is requesting API access to your workspace.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="rounded-full border border-blue-200/16 bg-blue-400/10 px-2.5 py-1 text-[10.5px] font-medium text-blue-100/80">
                      OAuth MCP
                    </span>
                    <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-medium text-white/54">
                      {clientTypeLabel}
                    </span>
                    <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-medium text-white/54">
                      Workspace scoped
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2.5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-[14px] font-medium text-white/92">Permissions</h2>
                    <p className="mt-1 text-[12.5px] leading-5 text-white/50">
                      The following scopes will apply to the selected workspace and connected resources.
                    </p>
                  </div>
                  <div className="hidden rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[10.5px] font-medium text-white/48 sm:block">
                    Review required
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {permissions.map((permission) => (
                    <PermissionRow key={permission.label} label={permission.label} tone={permission.tone} />
                  ))}
                </div>
              </div>

              <WorkspaceSelect
                workspaces={workspaces}
                selected={workspaceId}
                setSelected={setWorkspaceId}
                showError={showError}
              />

              {selectedWorkspace ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-blue-200/15 bg-blue-400/[0.08] p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-4 w-4 text-blue-100/76" />
                    <div>
                      <p className="text-[12px] font-semibold text-white/86">Selected workspace</p>
                      <p className="mt-1 text-[12.5px] leading-5 text-white/58">
                        {selectedWorkspace.name}{selectedWorkspace.subtitle ? ` — ${selectedWorkspace.subtitle}` : ""}. Authorization will be scoped to this workspace.
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse justify-end gap-3 border-t border-white/[0.08] bg-white/[0.025] px-5 py-3.5 sm:flex-row sm:px-6">
              <SecondaryButton onClick={decline}>Decline</SecondaryButton>
              <PrimaryButton loading={state === "loading"} disabled={workspaces.length === 0} onClick={authorize}>
                Authorize {productName}
              </PrimaryButton>
            </div>
          </motion.div>
        )}
      </section>
    </main>
  );
}
