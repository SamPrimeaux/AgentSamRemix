/**
 * Acceptance playbook for platform tickets — merges with live agentsam_tickets rows.
 * Cursor Canvas prototype lived beside chat; this is the in-app SSOT for pass/fail contracts.
 */

export type TicketPlaybookEntry = {
  what: string;
  needed: string;
  pass: string;
  fail: string;
  deliverable: string;
  steps: string;
  /** Lower = sooner in suggested batch */
  batch_rank?: number;
};

export const TICKET_PLAYBOOK_EXEC_ORDER =
  'Close in_review with proof first → P0#1 inferIntent front-door → Finding #3 unlocks ledger Phase B → reward single-writer unlocks cost_mean loop → child routing P0s.';

export const TICKET_PLAYBOOK_DEPS: string[] = [
  'hardcoded_routing_audit → P0#1 inferIntent → P0#2 code hub + P0#3 image guards + Design Studio pin',
  'finding_3_pending_status → ledger_ownership_b',
  'reward_events_tenant → arm_cost_mean_loop + consolidate_arm_writers',
  'classification_keywords_unify → tier_draft_quality_tiebreak',
  'thompson_cost_tier_split → paused_arm_orphan + latency_bias + cost_n1_seed',
];

export const TICKET_PLAYBOOK_NEXT_BATCH: {
  id: string;
  why: string;
  validation: string;
}[] = [
  {
    id: 'tkt_telemetry_002 + image intent in_review set',
    why: 'Likely code already landed — need pass/fail proof',
    validation: 'One paid image → cost_usd>0; golden image vs code prompts',
  },
  {
    id: 'tkt_finding_3_pending_status',
    why: 'Unblocks ledger ownership B',
    validation: 'New stub status ≠ error in tool_call_log',
  },
  {
    id: 'tkt_p0_infer_intent_heuristically',
    why: 'Parent poisoner for routing SSOT',
    validation: 'intent_decisions row drives taskType',
  },
  {
    id: 'tkt_reward_events_tenant',
    why: 'Unlocks cost_mean + arm consolidation',
    validation: 'Arm bump always paired with reward_events row',
  },
];

/** Playbook contracts keyed by agentsam_tickets.id */
export const TICKET_PLAYBOOK_BY_ID: Record<string, TicketPlaybookEntry> = {
  tkt_p0_infer_intent_heuristically: {
    what: 'SUPERSEDED: keyword/heuristic intent front-door retired — mode + model pin + tools(mode+policy). See MODE-MODEL-TOOLS-NUKE-PRELLM-CLASSIFIERS-2026-08.',
    needed:
      'Verify golden G1–G5 in prod; no second decision row; code-implementation hub next tranche.',
    pass: 'One decision row per turn (metadata spine=turn-decision-v1); [turn-decision] log; no bootstrap matched_by when D1 up.',
    fail: 'Duplicate decision rows, bootstrap-only route, or regex hub still sets taskType without decision.',
    deliverable: 'Golden matrix + SQL proof; mark in_review then shipped after Sam E2E.',
    steps: 'Run G1–G5 → paste decision ids → grep tail for [turn-decision] → close when green.',
    batch_rank: 3,
    doc: 'plans/active/ROUTING-SPINE-ONE-FRONT-DOOR.md',
  },
  tkt_classification_keywords_unify: {
    what: 'Intent nouns and tier cues (draft/standard/quality) should live in one D1 table, not split JS/legacy tables.',
    needed:
      'Confirm all hot-path readers use agentsam_classification_keywords; retire duplicate lists; migration/seed if gaps.',
    pass: 'No live alternate wordlists; keyword edits in D1 change gate behavior without redeploy (or documented cache TTL).',
    fail: 'JS still owns a parallel list that can disagree with D1.',
    deliverable: 'SSOT table + consumer list + in_review evidence (before/after keyword flip).',
    steps: 'Audit loaders → flip one keyword in D1 → retest image intent → close or reopen with gaps.',
    batch_rank: 1,
  },
  tkt_finding_3_pending_status: {
    what: 'tool_call_log (and mirrors) mark unfinished/pending rows as status=error, poisoning ownership and dashboards.',
    needed:
      'Introduce/use honest pending (or equivalent) status; stop writing error for stubs; backfill or document legacy rows.',
    pass: 'New pending stubs never land as error; queries for failures exclude pending; Finding #3 doc updated.',
    fail: 'Any new stub still written as error, or consumers treat pending as failure.',
    deliverable: 'Status enum fix + SQL proof counts (error vs pending) + unblock tkt_ledger_ownership_b.',
    steps: 'Find writers of status=error for stubs → change → deploy → D1 count check → set ownership_b active.',
    batch_rank: 2,
  },
  tkt_image_code_guard_false_positive: {
    what: 'Prompts like site/plan imagery were vetoed as code_implementation by gate order / regex.',
    needed: 'Confirm gate order + narrowed regex stay correct; no regression on real code asks.',
    pass: '“create a site plan image” → image path; “create a Next.js site” → code path; both logged honestly.',
    fail: 'Either false image or false code rejection on golden set.',
    deliverable: 'Golden prompt matrix (pass/fail) + decision rows; ticket closed only after matrix green.',
    steps: 'Run 6–8 prompts on /dashboard/agent; paste decision ids into ticket status_reason; close if green.',
    batch_rank: 1,
  },
  tkt_intent_keywords_classifier: {
    what: 'Keyword hit should escalate to classifier when ambiguous; decisions must be queryable; same-thread revision in scope of verify.',
    needed: 'Verify decision log for keyword vs escalate paths; same-thread “make it darker” still image.',
    pass: 'First image + follow-up revision both image; intent_decisions show matchedBy keyword or classifier.',
    fail: 'Follow-up drops to chat/code; or escalate never logs.',
    deliverable: 'Two-turn proof (session ids) + close/reopen note.',
    steps: 'New thread → image prompt → revision → query intent_decisions + tool_call_log.',
    batch_rank: 1,
  },
  tkt_telemetry_002: {
    what: 'Paid image tools previously wrote cost_usd=0 because handlers did not attach usage to execResult.',
    needed:
      'Image handlers bubble usage/cost; extractor SSOT; Gemini explicit imageSize; gpt-image quality matrix.',
    pass: 'Image fast path + imgx_* rows with cost_usd > 0; Gemini outbound has imageSize.',
    fail: 'Successful paid image with cost_usd=0 or null usage.',
    deliverable: 'Live tool_call_log rows with nonzero cost; plan verification checklist checked.',
    steps: 'Generate one Gemini + one gpt-image if available → D1 SELECT cost_usd → close or reopen gaps.',
    batch_rank: 1,
  },
  tkt_api_platform_catalog_validity: {
    what: 'Catalog still has google_interactions / null api_platform values that break or confuse dispatch.',
    needed:
      'Audit live catalog platforms; map each tool to a valid dispatch platform; fix rows or reject invalid at write.',
    pass: 'Zero active tools with null/unknown platform; dispatch never hits a dead platform.',
    fail: 'tools/list or in-app load still surfaces invalid platforms.',
    deliverable: 'D1 UPDATE/migration + before/after COUNT query.',
    steps: 'SELECT DISTINCT api_platform → classify → migrate → verify catalog.',
  },
  tkt_p0_code_implementation_intent: {
    what: 'code-implementation-intent.js is a second regex brain that bypasses intent_decisions.',
    needed: 'Consumers read intent_decisions (or shared front-door); hub becomes thin helper or deleted.',
    pass: 'No independent regex hub deciding turn lane; decisions logged for code asks.',
    fail: 'Hub still returns true/false without reading D1 decision.',
    deliverable: 'Refactored consumers + decision proof; findings P0#2 marked done.',
    steps: 'Wait for P0#1 → inventory imports of hub → switch to decision → delete dead regex.',
  },
  tkt_p0_image_gate_js_guards: {
    what: 'After keyword match, JS guards can still veto image without honest override policy.',
    needed: 'If D1 matched image, veto only via explicit logged override — never silent.',
    pass: 'Keyword-matched image prompts reach image path unless intent_decisions shows rejected_guard with reason.',
    fail: 'Match then silent chat/code with no decision or weak reason.',
    deliverable: 'Gate policy + decision samples.',
    steps: 'After P0#1, audit image-intent-gate.js order; remove silent paths; golden prompts.',
  },
  tkt_ledger_ownership_b: {
    what: 'mcp_proxy / ownership skip-flag work cannot proceed while pending looks like error.',
    needed: 'After Finding #3 green: implement ownership skip / Phase B per ownership plan.',
    pass: 'Pending rows skipped correctly; real errors still counted; ownership flags behave.',
    fail: 'Ownership logic still keys off status=error for stubs.',
    deliverable: 'Phase B code + D1 proof queries from plan.',
    steps: 'Unblock when Finding #3 closed → implement → verify → ship.',
  },
  tkt_reward_events_tenant: {
    what: 'Reward/arm updates must go through one writer so alpha/beta/cost_mean stay consistent per tenant.',
    needed:
      'Batch write agentsam_reward_events + arm update in applyRewardEvent; ban ad-hoc arm SQL on happy path.',
    pass: 'Image (and scoped) outcomes only mutate arms via applyRewardEvent; events row exists for each arm bump.',
    fail: 'Direct UPDATE success_alpha elsewhere without event.',
    deliverable: 'Single-writer module + call sites migrated for scoped paths.',
    steps: 'Inventory writers → funnel → manual image success/fail → D1 event+arm join.',
    batch_rank: 4,
  },
  tkt_arm_cost_mean_loop: {
    what: 'Thompson should learn cost, not only success — cost_mean updated on image outcomes.',
    needed: 'applyRewardEvent updates cost_mean from TELEMETRY-002 costs.',
    pass: 'After N paid images, arm cost_mean moves; selection score reflects cost.',
    fail: 'cost_usd logged but arm cost_mean unchanged.',
    deliverable: 'Before/after arm rows + selection log.',
    steps: 'Depends on reward single-writer + cost rows → wire cost into reward → retest.',
  },
  tkt_consolidate_arm_writers: {
    what: 'Multiple files still bump arm stats (routing, thompson, cms-theme, webhooks, eto, antigravity…).',
    needed: 'Phase 1 enumerate only — list call sites; do not jump to rewrite.',
    pass: 'Complete inventory table (file, function, when it writes); ticket notes phase complete.',
    fail: 'Partial list or silent code consolidation without checkpoint.',
    deliverable: 'Markdown inventory or ticket status_reason with file:line list.',
    steps: 'rg success_alpha / applyReward / routing_arms UPDATE → document → stop for review.',
  },
  tkt_github_read_many_empty_envelope: {
    what: 'Empty/stale GitHub envelope blocks legitimate code asks; handlers/allowlist partially fixed.',
    needed: 'E2E retest: code ask with GitHub tools returns content or clear retry, not silent empty block.',
    pass: 'Ask for a real repo file → tool succeeds or honest error; agent continues.',
    fail: 'Empty envelope still stalls the turn.',
    deliverable: 'E2E notes in status_reason; close if green.',
    steps: 'Agent thread with github_read_many → inspect tool_call_log → close/reopen.',
  },
  tkt_image_revision_followup: {
    what: 'Do not close noun-list fixes without deliberate revision retest.',
    needed: 'Same thread: generate → “make it warmer / change X” → must stay image path.',
    pass: 'Second turn image; intent decision shows revision/follow-up path.',
    fail: 'Second turn becomes chat-only or code.',
    deliverable: 'Session transcript + decision ids.',
    steps: 'Two-turn Design Studio or agent image chat; attach proof; close.',
  },
  tkt_phase_gate_stop: {
    what: 'Process rule: enumerate ≠ implement. Agents must pause at Phase gates.',
    needed: 'Keep as standing rule; reference in consolidate_arm_writers and similar.',
    pass: 'Phase tickets show enumerate deliverable before implement PR.',
    fail: 'Collapsed phases in one commit without review.',
    deliverable: 'Living process (no code); cite in PR bodies when relevant.',
    steps: 'When doing multi-phase tickets, update status_reason at each gate.',
  },
  tkt_thompson_cost_tier_split: {
    what: 'Draft/standard/quality should be separate arms with cost-aware priors/score blend.',
    needed: 'Verify live arms + selection uses tier; supersedes latency-bias ticket for image modes.',
    pass: 'Per-tier arm ids exist; selection logs tier arm; costs feed priors.',
    fail: 'All tiers share one alpha/beta.',
    deliverable: 'Arm table dump + selection proof; close after QA.',
    steps: 'Query per-tier arms → run draft + quality image → confirm different arm ids in logs → close if green.',
    batch_rank: 1,
  },
  tkt_connor_local_terminal_e2e: {
    what: 'Multi-user local lane: agentsam start-local + tunnel + dashboard Local validation for a BYOK member.',
    needed: 'Run full E2E as that member session; CF OAuth may need reconnect first.',
    pass: 'Local lane connects, PTY works, no cross-user bleed.',
    fail: 'Tunnel/auth/cwd fail or wrong tenant credentials.',
    deliverable: 'Signed E2E checklist in plan; ticket closed.',
    steps: 'Member CF reconnect if needed → start-local → tunnel → dashboard Local → commands.',
  },
  tkt_hardcoded_routing_audit: {
    what: 'Parent audit for all hidden reroutes on agent + Design Studio. Phase 1 findings already written.',
    needed: 'Track child P0s to done; keep findings SSOT; do not implement unification under this id alone.',
    pass: 'Children closed; findings marked complete; no new silent classifiers without ticket.',
    fail: 'New JS classifiers land without D1 + ticket.',
    deliverable: 'Findings doc maintained; children shipped.',
    steps: 'Keep findings SSOT updated as children land; close parent only when P0 children shipped.',
  },
  tkt_kimi_pricing_kind_mismatch: {
    what: 'Pricing lookup misses rows when DB has pricing_kind=workers_ai but query asks standard (or inverse).',
    needed: 'Align query + agentsam_model_pricing kind; add missing rows if needed.',
    pass: 'Kimi/Workers AI estimateModelRunCostUsd returns non-null for live models.',
    fail: 'Still silent miss → $0.',
    deliverable: 'SQL fix/migration + one successful cost estimate log.',
    steps: 'Reproduce miss → fix kind filter → retest kimi turn.',
  },
  tkt_p0_design_studio_pin: {
    what: 'Surface pin + CAD regex force design_studio route outside classification SSOT.',
    needed: 'Express pin/CAD as classification consumers of D1 decisions, not hard force.',
    pass: 'Design Studio turns log intent_decisions; CAD create not pure regex-only.',
    fail: 'Hard pin still bypasses with no decision.',
    deliverable: 'Refactored design-studio-context + proofs.',
    steps: 'After P0#1, refactor design-studio-context pin/CAD → D1 consumers → golden Design Studio prompts.',
  },
  tkt_paused_arm_quality_orphan: {
    what: 'Paused ra_img_*_ws / ra_7d90… arms hold quality_n/cost history not migrated to per-tier arms.',
    needed: 'One-shot migration of stats into draft/standard/quality arms; leave paused clean.',
    pass: 'Orphan arms zeroed/paused with note; tier arms carry migrated n/cost.',
    fail: 'History stranded; new arms cold-start unnecessarily.',
    deliverable: 'Migration SQL + before/after arm dump.',
    steps: 'Dump paused arm stats → write migration into tier arms → verify n/cost moved → pause orphans.',
  },
  tkt_tier_draft_quality_tiebreak: {
    what: 'Prompts like “final house plan” hit both draft and quality keywords.',
    needed: 'Product decision: draft-wins vs quality-wins vs classifier; encode in D1/policy.',
    pass: 'Deterministic documented winner; decision log shows tiebreak reason.',
    fail: 'Flip-flop by load order.',
    deliverable: 'Policy + keyword/classifier change + golden prompts.',
    steps: 'Decide policy → encode in keywords/classifier → golden conflicting prompts → ship.',
  },
  tkt_tool_call_json_leak: {
    what: 'Raw tool-call JSON (e.g. unexecuted read_file) appeared in assistant text.',
    needed: 'Strip/suppress tool JSON from visible stream; ensure tool executor path runs or fails closed.',
    pass: 'Reproduce prompt no longer shows raw JSON; tool either runs or clean error.',
    fail: 'JSON still visible in UI.',
    deliverable: 'Parser/stream fix + transcript.',
    steps: 'Reproduce → fix stream sanitizer / tool parse → redeploy → retest.',
  },
  tkt_model_attribution: {
    what: 'Need durable model/routing_arm fields on tool_call_log for reporting.',
    needed: 'Schema + writers after TELEMETRY-002 cost spine is trusted.',
    pass: 'New rows populate model (+ arm if applicable) correctly including fallbacks.',
    fail: 'Null model on paid tool success.',
    deliverable: 'Migration + writer + sample rows.',
    steps: 'Add columns → wire writers on image + tool loop → SELECT sample → ship.',
  },
  tkt_per_content_tier_arms: {
    what: 'Broader mockup vs presentation taxonomy beyond image draft/standard/quality.',
    needed: 'Keep backlog until image tier split is closed; then decide non-image content tiers.',
    pass: 'Spec accepted for non-image tiers OR ticket cancelled as out of scope.',
    fail: 'N/A until scoped.',
    deliverable: 'Spec or cancel note.',
    steps: 'After image tier arms closed, decide if non-image content tiers are needed; spec or cancel.',
  },
  tkt_thompson_cost_latency_bias: {
    what: 'General routing arms still success-only Beta; image path superseding via cost_tier_split.',
    needed: 'After image cost path, extend score blend to general routing arms.',
    pass: 'Latency/cost enter score for scoped non-image arms.',
    fail: 'Still success-only with no plan.',
    deliverable: 'Scoring change + arm metrics.',
    steps: 'Extend score blend beyond image tiers → log latency/cost inputs → prove selection shifts.',
  },
  tkt_tier_arm_cost_n1_seed: {
    what: 'Single seed observation dominates cost_mean until real n accumulates.',
    needed: 'Soft-cap, min_n, or freeze priors until threshold.',
    pass: 'Documented policy; early picks not wildly swung by one expensive seed.',
    fail: 'One row flips selection permanently.',
    deliverable: 'Policy in scoring code + scenarios.',
    steps: 'Define min_n/soft-cap → implement → simulate n=1 expensive seed → confirm no wild flip.',
  },
  tkt_timestamp_convention: {
    what: 'Prefer INTEGER unix created_at/updated_at; tool_call_log still has twin column partially filled.',
    needed: 'Know-it-exists until reporting needs mixed tables; then migrate writers.',
    pass: 'New tables follow convention; tool_call_log writers consistent when reporting needs it.',
    fail: 'New _unix twin columns added.',
    deliverable: 'Convention note + optional backfill when reporting blocked.',
    steps: 'Defer until reporting blocked; then align writers and optionally backfill tool_call_log.',
  },
  tkt_collaborate_ticket_drawer: {
    what: 'UI for client tasks — not agentsam_tickets platform board.',
    needed: 'Product UI when Collaborate lane prioritizes it.',
    pass: 'Drawer CRUD for client tasks works.',
    fail: 'N/A until scheduled.',
    deliverable: 'UI + API for client task store.',
    steps: 'Schedule when Collaborate UI is prioritized; do not confuse with agentsam_tickets board.',
  },
  tkt_flux_thompson_limbo: {
    what: 'flux-* models sit in limbo relative to live Thompson pool.',
    needed: 'Product decision + either arm seed or docs saying excluded.',
    pass: 'Decision recorded; catalog/arms match decision.',
    fail: 'Flux randomly selectable with no arm / cost story.',
    deliverable: 'Decision note + arms or exclusion doc.',
    steps: 'Decide → seed arms or write exclusion → update catalog notes.',
  },
  tkt_designstudio_002: {
    what: 'Sam Sketch dream home — Artifact Engine with FreeCAD master, OpenSCAD component generators, Blender derivatives. Replace operator script injection with real executors + human inspector.',
    needed:
      'Research receipt (official OpenSCAD CLI + FreeCAD BIM docs); Test A OpenSCAD smoke; Test B FreeCAD 60×40 blockout on proj_mrb5shkc_3kos2c; operators map to catalog tools; DESIGNSTUDIO-001 project binding.',
    pass: 'Test A 5/5 + Test B 7/7 checklist green; wall edit works in inspector without agent; tool_call_log shows freecad/openscad executor keys; FCStd revisions retained.',
    fail: 'Operators still only dump chat prompts; no artifact revisions; Meshy default for architectural generate; no web-search research receipt.',
    deliverable: 'Research URLs in ticket events + R2/D1 proof rows + inspector screenshot + decision row for modify.',
    steps: 'Web search mandate → trace operators.ts → wire Test A → wire Test B → human GUI panels → close with proof matrix.',
    batch_rank: 2,
    doc: 'plans/active/DESIGNSTUDIO-002-dream-home-artifact-engine.md',
  },
  tkt_designstudio_003: {
    what: 'Architectural plan lane — PlanGraph bridge between visual_canvas and FreeCAD, with stable semantic IDs and VisualizationPackage lineage hooks for Blender (004).',
    needed:
      'architectural_plan D1 profile + plan_graph_* tools; iam.plan_graph.v1 with semantic IDs; promote_plan returns FCStd id + units/coords; post-promotion visualization_package_create hook (stub OK); design_visualization route shell; linked tkt_designstudio_004.',
    pass: 'Sketch/upload → PlanGraph (IDs) → promote → FCStd v1 + GLB derivative; lineage fields; flow metadata includes visualization_blender; 004 ticket blocked_by 003.',
    fail: '2D plans still fake via imgx; no semantic IDs; Blender treated as geometry master; no viz hook surface.',
    deliverable: 'PlanGraph artifact + promote receipt + D1 profiles + DESIGNSTUDIO-003 acceptance checks.',
    steps: 'Schema + D1 lane → review UI → promote_plan + hook stub → gate ×2. Do not implement Blender executor (004).',
    batch_rank: 3,
    doc: 'plans/active/DESIGNSTUDIO-003-architectural-plan-lane.md',
  },
  tkt_designstudio_004: {
    what: 'FreeCAD → VisualizationPackage → Blender presentation lane (persistent design_visualization branch).',
    needed:
      '003 semantic IDs + promote hook green; VisualizationPackage writer; CAD_SYNC Blender import; one exterior camera + lighting preset + preview render; sync policy preview_then_apply / archive_orphaned.',
    pass: 'PlanGraph→FCStd→VizPackage→BLEND→preview; wall move → FCStd v2 → sync preserves materials/cameras → BLEND v2 → rerender.',
    fail: 'FCStd→random GLB→Blender with no semantic IDs; Blender becomes architectural master; auto-delete orphans.',
    deliverable: 'BLEND + manifest + render-recipe + preview lineage on Sam Sketch.',
    steps: 'Wait for 003 → package writer → Blender CAD_SYNC → exterior preview only.',
    batch_rank: 4,
    doc: 'plans/active/DESIGNSTUDIO-004-freecad-blender-visualization.md',
  },
};

export function getTicketPlaybook(id: string): TicketPlaybookEntry | null {
  return TICKET_PLAYBOOK_BY_ID[String(id || '').trim()] || null;
}
