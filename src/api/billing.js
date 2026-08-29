/**
 * Billing API — plans, subscriptions, Stripe Checkout / Portal / webhooks, invoices.
 * STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET: Worker secrets only (never D1).
 */
import { getAuthUser, fetchAuthUserTenantId, fallbackSystemTenantId } from '../core/auth.js';
import { jsonResponse } from '../core/responses.js';
import { stripeRequest, verifyStripeSignature } from '../integrations/stripe.js';

const CHECKOUT_SUCCESS_URL =
  'https://inneranimalmedia.com/dashboard/settings/billing?checkout=success';
const CHECKOUT_CANCEL_URL =
  'https://inneranimalmedia.com/dashboard/settings/billing?checkout=cancelled';
const PORTAL_RETURN_URL = 'https://inneranimalmedia.com/dashboard/settings/billing';

/** @param {any} env @param {any} authUser */
async function resolveTenantId(env, authUser) {
  if (authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = authUser?.id ? await fetchAuthUserTenantId(env, authUser.id) : null;
  if (tid) return tid;
  if (authUser?.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

/** @param {any} plan @param {string} [billingPeriod] */
function pickStripePriceId(plan, billingPeriod) {
  const p = String(billingPeriod || 'monthly').toLowerCase();
  const yearly = p === 'year' || p === 'yearly' || p === 'annual';
  if (yearly && plan.stripe_price_id_annual) {
    return String(plan.stripe_price_id_annual).trim();
  }
  return (
    plan.stripe_price_id_monthly ||
    plan.stripe_price_id ||
    plan.stripe_price_monthly ||
    plan.stripe_price_id_yearly ||
    null
  );
}

/** @param {any} env @param {string} stripeCustomerId */
async function tenantIdFromStripeCustomer(env, stripeCustomerId) {
  if (!env?.DB || !stripeCustomerId) return null;
  const row = await env.DB.prepare(
    `SELECT tenant_id FROM billing_customers WHERE stripe_customer_id = ? LIMIT 1`,
  )
    .bind(String(stripeCustomerId).trim())
    .first();
  return row?.tenant_id != null ? String(row.tenant_id).trim() : null;
}

/** @param {any} env @param {string} tenantId */
async function billingAccountIdForTenant(env, tenantId) {
  if (!env?.DB || !tenantId) return null;
  const row = await env.DB.prepare(
    `SELECT id FROM billing_accounts WHERE tenant_id = ? LIMIT 1`,
  )
    .bind(tenantId)
    .first();
  return row?.id != null ? String(row.id).trim() : null;
}

/** @param {any} env @param {string} stripePriceId */
async function planIdFromStripePriceId(env, stripePriceId) {
  if (!env?.DB || !stripePriceId) return null;
  const pid = String(stripePriceId).trim();
  const row = await env.DB.prepare(
    `SELECT id FROM billing_plans
     WHERE stripe_price_id = ? OR stripe_price_id_annual = ?
     LIMIT 1`,
  )
    .bind(pid, pid)
    .first();
  return row?.id != null ? String(row.id).trim() : null;
}

/** @param {number | null | undefined} unixSec */
function monthYmFromUnix(unixSec) {
  if (unixSec == null || !Number.isFinite(Number(unixSec))) return null;
  const d = new Date(Number(unixSec) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** @param {any} v */
function safeJsonString(v) {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return '{}';
  }
}

/**
 * Primary webhook audit row (matches D1 agentsam_webhook_events schema).
 * @param {any} env
 * @param {string | undefined} eventType
 * @param {string} rawBody
 * @param {string | null} [tenantId]
 */
async function logAgentsamWebhookEvent(env, eventType, rawBody, tenantId = null) {
  let eventId = null;
  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
    if (payload?.id) eventId = String(payload.id);
  } catch {
    payload = null;
  }
  const { insertAgentsamWebhookEvent } = await import('../../backend/services/webhooks/ledger.js');
  await insertAgentsamWebhookEvent(env, {
    tenantId: tenantId ?? null,
    provider: 'stripe',
    eventType: eventType || 'unknown',
    eventId,
    payload,
    metadata: payload?.object ? { stripe_object: String(payload.object).slice(0, 80) } : null,
    endpointPath: '/api/webhooks/stripe',
    status: 'received',
  });
}

/** Payload traces belong on billing/usage tables, not the webhook ledger. */
async function logAgentsamWebhookPayloadJson(_env, _eventType, _payloadObj, _tenantId = null) {
  return;
}

/** @param {any} env @param {string} tenantId @param {string} stripeCustomerId */
async function upsertBillingCustomer(env, tenantId, stripeCustomerId) {
  const row = await env.DB.prepare(
    `SELECT tenant_id FROM billing_customers WHERE tenant_id = ? LIMIT 1`,
  )
    .bind(tenantId)
    .first();
  if (row?.tenant_id) {
    await env.DB.prepare(
      `UPDATE billing_customers SET stripe_customer_id = ?, updated_at = unixepoch() WHERE tenant_id = ?`,
    )
      .bind(stripeCustomerId, tenantId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO billing_customers (tenant_id, stripe_customer_id, created_at, updated_at)
       VALUES (?, ?, unixepoch(), unixepoch())`,
    )
      .bind(tenantId, stripeCustomerId)
      .run();
  }
}

/**
 * @param {any} sub Stripe Subscription object
 */
function deriveSubscriptionFields(sub) {
  const item0 = sub?.items?.data?.[0];
  const price = item0?.price;
  const qty = item0?.quantity != null ? Number(item0.quantity) : 1;
  const seats = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
  const interval = price?.recurring?.interval ? String(price.recurring.interval).toLowerCase() : '';
  let billingPeriod = 'monthly';
  if (interval === 'year') billingPeriod = 'annual';
  else if (interval === 'month' || interval === 'monthly') billingPeriod = 'monthly';
  const amountCents =
    price?.unit_amount != null ? Number(price.unit_amount) : sub?.plan?.amount != null ? Number(sub.plan.amount) : null;
  const trialEndsUnix = sub?.trial_end != null ? Number(sub.trial_end) : null;
  const trialEndsAt =
    trialEndsUnix != null && Number.isFinite(trialEndsUnix)
      ? Math.floor(trialEndsUnix)
      : null;
  const wsMeta = sub?.metadata?.workspace_id ? String(sub.metadata.workspace_id).trim() : null;
  const cps =
    sub?.current_period_start != null ? Math.floor(Number(sub.current_period_start)) : null;
  const cpe =
    sub?.current_period_end != null ? Math.floor(Number(sub.current_period_end)) : null;
  return {
    seats,
    billingPeriod,
    amountCents,
    trialEndsAt,
    workspaceId: wsMeta || null,
    priceId: price?.id ? String(price.id) : null,
    current_period_start: cps,
    current_period_end: cpe,
  };
}

/**
 * @param {any} env
 * @param {{
 *   tenant_id: string,
 *   plan_id: string,
 *   stripe_subscription_id: string,
 *   stripe_customer_id: string,
 *   status: string,
 *   current_period_start: number | null,
 *   current_period_end: number | null,
 *   amount_cents: number | null,
 *   billing_period?: string | null,
 *   seats?: number | null,
 *   trial_ends_at?: string | null,
 *   workspace_id?: string | null,
 * }} row
 */
async function upsertBillingSubscriptionFromStripe(env, row) {
  const ex = await env.DB.prepare(
    `SELECT tenant_id FROM billing_subscriptions WHERE tenant_id = ? LIMIT 1`,
  )
    .bind(row.tenant_id)
    .first();
  const amt = row.amount_cents != null ? Number(row.amount_cents) : null;
  const seats = row.seats != null ? Number(row.seats) : 1;
  const bp = row.billing_period || 'monthly';

  if (ex?.tenant_id) {
    await env.DB.prepare(
      `UPDATE billing_subscriptions SET
        plan_id = ?,
        status = ?,
        stripe_subscription_id = ?,
        stripe_customer_id = ?,
        current_period_start = ?,
        current_period_end = ?,
        amount_cents = ?,
        billing_period = ?,
        seats = ?,
        trial_ends_at = ?,
        workspace_id = COALESCE(?, workspace_id),
        updated_at = unixepoch()
       WHERE tenant_id = ?`,
    )
      .bind(
        row.plan_id,
        row.status,
        row.stripe_subscription_id,
        row.stripe_customer_id,
        row.current_period_start,
        row.current_period_end,
        amt,
        bp,
        seats,
        row.trial_ends_at ?? null,
        row.workspace_id ?? null,
        row.tenant_id,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO billing_subscriptions (
        tenant_id, plan_id, status, stripe_subscription_id, stripe_customer_id,
        current_period_start, current_period_end, amount_cents,
        billing_period, seats, trial_ends_at, workspace_id,
        cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())`,
    )
      .bind(
        row.tenant_id,
        row.plan_id,
        row.status,
        row.stripe_subscription_id,
        row.stripe_customer_id,
        row.current_period_start,
        row.current_period_end,
        amt,
        bp,
        seats,
        row.trial_ends_at ?? null,
        row.workspace_id ?? null,
      )
      .run();
  }
}

/** @param {any} env @param {string} tenantId @param {any} n */
async function insertNotification(env, tenantId, n) {
  const id = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO notifications (
      id, recipient_id, recipient_type, channel, subject, message,
      entity_type, entity_id, priority, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      n.recipient_type || 'tenant',
      n.channel || 'email',
      n.subject || '',
      n.message || '',
      n.entity_type || null,
      n.entity_id != null ? String(n.entity_id) : null,
      n.priority || 'normal',
      n.status || 'pending',
    )
    .run();
}

/** @param {any} session checkout.session object */
function extractCheckoutCouponId(session) {
  const d = session?.discount;
  if (d?.coupon?.id) return String(d.coupon.id);
  if (typeof d?.coupon === 'string') return d.coupon;
  const td = session?.total_details;
  const discounts = td?.breakdown?.discounts;
  if (Array.isArray(discounts) && discounts[0]?.discount?.coupon?.id) {
    return String(discounts[0].discount.coupon.id);
  }
  if (Array.isArray(session?.discounts) && session.discounts[0]?.coupon?.id) {
    return String(session.discounts[0].coupon.id);
  }
  return null;
}

/** @param {any} env @param {string | null} stripeCouponId */
async function incrementCouponRedemption(env, stripeCouponId) {
  if (!stripeCouponId || !env.DB) return;
  await env.DB.prepare(
    `UPDATE billing_coupons SET redemption_count = COALESCE(redemption_count, 0) + 1
     WHERE stripe_coupon_id = ? AND COALESCE(is_active, 1) = 1`,
  )
    .bind(stripeCouponId)
    .run();
}

/** @param {any} env @param {any} event */
async function dispatchStripeEvent(env, event) {
  const type = event?.type;
  const data = event?.data?.object;

  if (type === 'checkout.session.completed') {
    const session = data;
    const tenantId = session?.metadata?.tenant_id ? String(session.metadata.tenant_id).trim() : '';
    const planId = session?.metadata?.plan_id ? String(session.metadata.plan_id).trim() : '';
    const customerId =
      typeof session?.customer === 'string'
        ? session.customer
        : session?.customer?.id
          ? String(session.customer.id)
          : '';
    const subId =
      typeof session?.subscription === 'string'
        ? session.subscription
        : session?.subscription?.id
          ? String(session.subscription.id)
          : '';

    if (tenantId && customerId) {
      await upsertBillingCustomer(env, tenantId, customerId);
    }
    const couponId = extractCheckoutCouponId(session);
    if (couponId) void incrementCouponRedemption(env, couponId);

    if (tenantId && subId && customerId) {
      const sub = await stripeRequest(env, 'GET', `/subscriptions/${encodeURIComponent(subId)}`);
      const der = deriveSubscriptionFields(sub);
      const resolvedFromPrice = der.priceId ? await planIdFromStripePriceId(env, der.priceId) : null;
      const resolvedPlanId = planId || resolvedFromPrice;
      if (resolvedPlanId) {
        await upsertBillingSubscriptionFromStripe(env, {
          tenant_id: tenantId,
          plan_id: resolvedPlanId,
          stripe_subscription_id: subId,
          stripe_customer_id: customerId,
          status: String(sub?.status || 'active'),
          current_period_start: der.current_period_start,
          current_period_end: der.current_period_end,
          amount_cents: der.amountCents,
          billing_period: der.billingPeriod,
          seats: der.seats,
          trial_ends_at: der.trialEndsAt,
          workspace_id: der.workspaceId,
        });
      }
    }
    return;
  }

  if (type === 'customer.subscription.created') {
    const o = data;
    const stripeSubId = o?.id ? String(o.id) : '';
    const custRef = o?.customer;
    const customerId =
      typeof custRef === 'string' ? custRef : custRef?.id ? String(custRef.id) : '';
    if (!stripeSubId || !customerId) return;
    void logAgentsamWebhookPayloadJson(env, type, o, await tenantIdFromStripeCustomer(env, customerId));
    const tenantId = await tenantIdFromStripeCustomer(env, customerId);
    if (!tenantId) return;
    const der = deriveSubscriptionFields(o);
    const planId =
      (der.priceId && (await planIdFromStripePriceId(env, der.priceId))) ||
      (o?.metadata?.plan_id ? String(o.metadata.plan_id).trim() : '');
    if (!planId) return;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO billing_subscriptions (
        tenant_id, stripe_subscription_id, plan_id, status,
        current_period_start, current_period_end, cancel_at_period_end,
        workspace_id, seats, trial_ends_at, stripe_customer_id, billing_period, amount_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(
        tenantId,
        stripeSubId,
        planId,
        String(o.status || 'active'),
        der.current_period_start,
        der.current_period_end,
        o.cancel_at_period_end ? 1 : 0,
        der.workspaceId,
        der.seats,
        der.trialEndsAt,
        customerId,
        der.billingPeriod,
        der.amountCents != null ? der.amountCents : 0,
      )
      .run();
    await insertNotification(env, tenantId, {
      recipient_type: 'tenant',
      channel: 'email',
      subject: 'Welcome — your subscription is active',
      message:
        'Your plan is now active. Visit your dashboard to get started.',
      entity_type: 'billing_subscription',
      entity_id: stripeSubId,
      priority: 'high',
      status: 'pending',
    });
    return;
  }

  if (type === 'customer.subscription.updated') {
    const o = data;
    const stripeSubId = o?.id ? String(o.id) : '';
    if (!stripeSubId) return;
    void logAgentsamWebhookPayloadJson(env, type, o);
    const der = deriveSubscriptionFields(o);
    await env.DB.prepare(
      `UPDATE billing_subscriptions SET
        status = ?,
        current_period_start = ?,
        current_period_end = ?,
        cancel_at_period_end = ?,
        billing_period = ?,
        seats = ?,
        trial_ends_at = ?,
        amount_cents = COALESCE(?, amount_cents),
        updated_at = unixepoch()
       WHERE stripe_subscription_id = ?`,
    )
      .bind(
        String(o.status || ''),
        der.current_period_start,
        der.current_period_end,
        o.cancel_at_period_end ? 1 : 0,
        der.billingPeriod,
        der.seats,
        der.trialEndsAt,
        der.amountCents,
        stripeSubId,
      )
      .run();
    return;
  }

  if (type === 'customer.subscription.deleted') {
    const o = data;
    const stripeSubId = o?.id ? String(o.id) : '';
    if (!stripeSubId) return;
    void logAgentsamWebhookPayloadJson(env, type, o);
    await env.DB.prepare(
      `UPDATE billing_subscriptions SET status = 'canceled', updated_at = unixepoch() WHERE stripe_subscription_id = ?`,
    )
      .bind(stripeSubId)
      .run();
    return;
  }

  if (type === 'invoice.paid') {
    const inv = data;
    void logAgentsamWebhookPayloadJson(env, type, inv);
    const amountPaid = inv?.amount_paid != null ? Number(inv.amount_paid) : 0;
    if (!amountPaid) return;
    const custRef = inv?.customer;
    const customerId =
      typeof custRef === 'string' ? custRef : custRef?.id ? String(custRef.id) : '';
    if (!customerId) return;
    const tenantId = await tenantIdFromStripeCustomer(env, customerId);
    if (!tenantId) return;
    const billingAccountId = await billingAccountIdForTenant(env, tenantId);
    if (!billingAccountId) return;
    const periodEnd = inv?.period_end != null ? Number(inv.period_end) : null;
    const month = monthYmFromUnix(periodEnd);
    if (!month) return;
    const cu = await env.DB.prepare(
      `SELECT email FROM billing_customers WHERE tenant_id = ? LIMIT 1`,
    )
      .bind(tenantId)
      .first();
    const ba = await env.DB.prepare(
      `SELECT account_email FROM billing_accounts WHERE id = ? LIMIT 1`,
    )
      .bind(billingAccountId)
      .first();
    const userEmail = String(cu?.email || ba?.account_email || 'billing@inneranimalmedia.com');
    const subtotalUsd = amountPaid / 100;
    const summaryId = `bsum_${billingAccountId}_${month}`;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO billing_summary (
        id, billing_account_id, user_email, month, provider,
        subscription_total_usd, total_spend_usd, total_calls,
        total_input_tokens, total_output_tokens, updated_at
      ) VALUES (?, ?, ?, ?, 'stripe', ?, ?, 0, 0, 0, unixepoch())`,
    )
      .bind(summaryId, billingAccountId, userEmail, month, subtotalUsd, subtotalUsd)
      .run();
    return;
  }

  if (type === 'invoice.finalized') {
    void logAgentsamWebhookPayloadJson(env, type, data);
    return;
  }

  if (type === 'invoice.finalization_failed') {
    const inv = data;
    void logAgentsamWebhookPayloadJson(env, type, inv);
    const custRef = inv?.customer;
    const customerId =
      typeof custRef === 'string' ? custRef : custRef?.id ? String(custRef.id) : '';
    const tenantId = customerId ? await tenantIdFromStripeCustomer(env, customerId) : null;
    const invId = inv?.id != null ? String(inv.id) : 'unknown';
    const fid = `find_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (tenantId) {
      await env.DB.prepare(
        `INSERT INTO security_findings (
          id, tenant_id, source_type, source_ref, finding_type,
          severity, status, created_by, metadata_json
        ) VALUES (?, ?, 'stripe', ?, 'invoice_finalization_failed', 'high', 'open', 'stripe_webhook', ?)`,
      )
        .bind(fid, tenantId, invId, safeJsonString(inv))
        .run();
      await insertNotification(env, tenantId, {
        channel: 'dashboard',
        subject: 'Invoice finalization failed',
        message: `Stripe could not finalize invoice ${invId}. Check billing settings.`,
        entity_type: 'invoice',
        entity_id: invId,
        priority: 'high',
        status: 'pending',
      });
    }
    return;
  }

  if (type === 'invoice.upcoming') {
    const inv = data;
    void logAgentsamWebhookPayloadJson(env, type, inv);
    const custRef = inv?.customer;
    const customerId =
      typeof custRef === 'string' ? custRef : custRef?.id ? String(custRef.id) : '';
    if (!customerId) return;
    const tenantId = await tenantIdFromStripeCustomer(env, customerId);
    if (!tenantId) return;
    const amtDue = inv?.amount_due != null ? Number(inv.amount_due) / 100 : 0;
    const nextPay = inv?.next_payment_attempt != null ? Number(inv.next_payment_attempt) : null;
    const dateStr =
      nextPay != null && Number.isFinite(nextPay)
        ? new Date(nextPay * 1000).toLocaleDateString()
        : 'soon';
    await insertNotification(env, tenantId, {
      channel: 'email',
      subject: 'Your subscription renews soon',
      message: `Your next invoice of $${amtDue.toFixed(2)} will be charged on ${dateStr}.`,
      entity_type: 'invoice',
      entity_id: inv?.id != null ? String(inv.id) : null,
      priority: 'normal',
      status: 'pending',
    });
    return;
  }

  if (type === 'invoice.payment_action_required') {
    const inv = data;
    void logAgentsamWebhookPayloadJson(env, type, inv);
    const custRef = inv?.customer;
    const customerId =
      typeof custRef === 'string' ? custRef : custRef?.id ? String(custRef.id) : '';
    if (!customerId) return;
    const tenantId = await tenantIdFromStripeCustomer(env, customerId);
    if (!tenantId) return;
    const url = inv?.hosted_invoice_url ? String(inv.hosted_invoice_url) : '';
    await insertNotification(env, tenantId, {
      channel: 'email',
      subject: 'Action required — payment needs your attention',
      message: url
        ? `Complete payment: ${url}`
        : 'Your payment requires authentication. Open your billing portal to continue.',
      entity_type: 'invoice',
      entity_id: inv?.id != null ? String(inv.id) : null,
      priority: 'high',
      status: 'pending',
    });
    return;
  }

  if (type === 'invoice.updated') {
    void logAgentsamWebhookPayloadJson(env, type, data);
    return;
  }

  if (typeof type === 'string' && type.startsWith('subscription_schedule.')) {
    void logAgentsamWebhookPayloadJson(env, type, data);
    return;
  }

  if (type === 'payment_intent.created') {
    void logAgentsamWebhookPayloadJson(env, type, data);
    return;
  }

  if (type === 'payment_intent.succeeded') {
    const pi = data;
    void logAgentsamWebhookPayloadJson(env, type, pi);
    const invId = pi?.metadata?.invoice_id ? String(pi.metadata.invoice_id).trim() : '';
    if (invId) {
      await logAgentsamWebhookPayloadJson(
        env,
        'payment_intent.succeeded:invoice_ack',
        { invoice_id: invId, payment_intent_id: pi?.id },
      );
    }
    return;
  }

  if (type === 'invoice.payment_failed') {
    const inv = data;
    void logAgentsamWebhookPayloadJson(env, type, inv);
    const subRef = inv?.subscription;
    const stripeSubId =
      typeof subRef === 'string' ? subRef : subRef?.id ? String(subRef.id) : '';
    if (!stripeSubId) return;
    await env.DB.prepare(
      `UPDATE billing_subscriptions SET status = 'past_due', updated_at = unixepoch() WHERE stripe_subscription_id = ?`,
    )
      .bind(stripeSubId)
      .run();
  }
}

/**
 * Stripe billing webhooks — signature verify, audit row, registry workflow dispatch.
 * @param {Request} request
 * @param {any} env
 * @param {import('@cloudflare/workers-types').ExecutionContext} [ctx]
 */
export async function handleStripeWebhook(request, env, ctx) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || String(secret).trim() === '') {
    return jsonResponse({ error: 'Webhook secret not configured' }, 500);
  }
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') || '';
  const ok = await verifyStripeSignature(rawBody, sigHeader, secret);
  if (!ok) return jsonResponse({ error: 'Invalid signature' }, 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  let tenantId = null;
  const obj = event?.data?.object;
  const customerRef =
    obj && typeof obj === 'object'
      ? obj.customer ?? obj.customer_id ?? null
      : null;
  if (customerRef) {
    tenantId = await tenantIdFromStripeCustomer(
      env,
      typeof customerRef === 'string' ? customerRef : String(customerRef?.id ?? ''),
    );
  }

  const { ingestWebhookEventAndDispatch } = await import('../../backend/http/webhooks/ingest.js');
  await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId,
    workspaceId: null,
    provider: 'stripe',
    eventType: event?.type || 'unknown',
    eventId: event?.id != null ? String(event.id) : null,
    payload: event,
    endpointPath: '/api/webhooks/stripe',
    signatureValid: true,
  });

  try {
    await dispatchStripeEvent(env, event);
  } catch (e) {
    console.error('[billing webhook] dispatch', e?.message ?? e);
  }
  return jsonResponse({ received: true });
}

/** @param {any} inv */
function mapInvoiceSafe(inv) {
  if (!inv || typeof inv !== 'object') return null;
  return {
    id: inv.id != null ? String(inv.id) : '',
    amount_paid: inv.amount_paid != null ? Number(inv.amount_paid) : 0,
    status: inv.status != null ? String(inv.status) : '',
    period_start: inv.period_start != null ? Number(inv.period_start) : null,
    period_end: inv.period_end != null ? Number(inv.period_end) : null,
    invoice_pdf: inv.invoice_pdf != null ? String(inv.invoice_pdf) : null,
    hosted_invoice_url: inv.hosted_invoice_url != null ? String(inv.hosted_invoice_url) : null,
  };
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {any} _ctx
 */
export async function handleBillingApi(request, url, env, _ctx) {
  const path =
    (url.pathname || '/').replace(/\/$/, '') || '/';
  const pathLower = path.toLowerCase();
  const method = (request.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Terminal-Secret',
      },
    });
  }

  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  if (pathLower === '/api/webhooks/stripe' && method === 'POST') {
    return handleStripeWebhook(request, env, _ctx);
  }

  if (pathLower === '/api/billing/plans' && method === 'GET') {
    try {
      const plansRes = await env.DB.prepare(
        `SELECT id,
          COALESCE(display_name, name) AS display_name,
          COALESCE(tagline, '') AS tagline,
          billing_period,
          trial_days,
          monthly_token_limit,
          daily_request_limit,
          max_concurrency,
          allows_byok,
          features_json,
          sort_order
         FROM billing_plans
         WHERE COALESCE(is_active, 1) = 1
         ORDER BY COALESCE(sort_order, 999999), id`,
      ).all();
      const couponsRes = await env.DB.prepare(
        `SELECT id, stripe_coupon_id, name, description, percent_off,
                duration, duration_in_months, eligible_plan_ids,
                requires_verification, is_active
         FROM billing_coupons
         WHERE COALESCE(is_active, 1) = 1`,
      ).all();
      return jsonResponse({
        plans: plansRes.results || [],
        coupons: couponsRes.results || [],
      });
    } catch (e) {
      console.warn('[billing/plans]', e?.message ?? e);
      return jsonResponse({ error: String(e?.message || e) }, 500);
    }
  }

  if (pathLower === '/api/billing/subscription' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tenantId = await resolveTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant not resolved' }, 400);
    try {
      const row = await env.DB.prepare(
        `SELECT bs.*, COALESCE(bp.display_name, bp.name) AS display_name, bp.features_json
         FROM billing_subscriptions bs
         JOIN billing_plans bp ON bs.plan_id = bp.id
         WHERE bs.tenant_id = ?`,
      )
        .bind(tenantId)
        .first();
      if (!row) return jsonResponse({ subscription: null }, 404);
      return jsonResponse({ subscription: row });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 500);
    }
  }

  if (pathLower === '/api/billing' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tenantId = await resolveTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant not resolved' }, 400);
    try {
      const { results } = await env.DB.prepare(
        `SELECT bs.*, bp.name AS plan_display_name, bp.monthly_token_limit, bp.features_json,
          ba.account_email, ba.billing_name, ba.account_status
         FROM billing_subscriptions bs
         LEFT JOIN billing_plans bp ON bp.id = bs.plan_id
         LEFT JOIN billing_accounts ba ON ba.tenant_id = bs.tenant_id
         WHERE bs.tenant_id = ?
         ORDER BY bs.updated_at DESC LIMIT 100`,
      )
        .bind(tenantId)
        .all();
      return jsonResponse({ subscriptions: results || [] });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 500);
    }
  }

  if (pathLower === '/api/billing/checkout' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tenantId = await resolveTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant not resolved' }, 400);

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const planId = body.plan_id != null ? String(body.plan_id).trim() : '';
    const billingPeriod = body.billing_period != null ? String(body.billing_period).trim() : '';
    if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);

    const plan = await env.DB.prepare(`SELECT * FROM billing_plans WHERE id = ? LIMIT 1`)
      .bind(planId)
      .first();
    if (!plan) return jsonResponse({ error: 'Plan not found' }, 404);

    const priceId = pickStripePriceId(plan, billingPeriod);
    if (!priceId) return jsonResponse({ error: 'Plan has no Stripe price configured' }, 400);

    const custRow = await env.DB.prepare(
      `SELECT stripe_customer_id FROM billing_customers WHERE tenant_id = ? LIMIT 1`,
    )
      .bind(tenantId)
      .first();
    const stripeCustomerId = custRow?.stripe_customer_id
      ? String(custRow.stripe_customer_id).trim()
      : '';
    const email =
      authUser.email && String(authUser.email).includes('@')
        ? String(authUser.email).trim()
        : '';

    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    if (stripeCustomerId) {
      params.set('customer', stripeCustomerId);
    } else if (email) {
      params.set('customer_email', email);
    } else {
      return jsonResponse({ error: 'No customer email on account' }, 400);
    }
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.set('success_url', CHECKOUT_SUCCESS_URL);
    params.set('cancel_url', CHECKOUT_CANCEL_URL);
    params.set('metadata[tenant_id]', tenantId);
    params.set('metadata[plan_id]', planId);

    const trialDays = plan.trial_days != null ? Number(plan.trial_days) : 0;
    if (Number.isFinite(trialDays) && trialDays > 0) {
      params.set('subscription_data[trial_period_days]', String(Math.floor(trialDays)));
    }

    try {
      const session = await stripeRequest(env, 'POST', '/checkout/sessions', params);
      const checkoutUrl = session?.url ? String(session.url) : '';
      if (!checkoutUrl) return jsonResponse({ error: 'No checkout URL returned' }, 502);
      return jsonResponse({ checkout_url: checkoutUrl });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 502);
    }
  }

  if (pathLower === '/api/billing/portal' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tenantId = await resolveTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant not resolved' }, 400);

    const custRow = await env.DB.prepare(
      `SELECT stripe_customer_id FROM billing_customers WHERE tenant_id = ? LIMIT 1`,
    )
      .bind(tenantId)
      .first();
    const stripeCustomerId = custRow?.stripe_customer_id
      ? String(custRow.stripe_customer_id).trim()
      : '';
    if (!stripeCustomerId) return jsonResponse({ error: 'No Stripe customer for tenant' }, 400);

    try {
      const portal = await stripeRequest(env, 'POST', '/billing_portal/sessions', {
        customer: stripeCustomerId,
        return_url: PORTAL_RETURN_URL,
      });
      const portalUrl = portal?.url ? String(portal.url) : '';
      if (!portalUrl) return jsonResponse({ error: 'No portal URL returned' }, 502);
      return jsonResponse({ portal_url: portalUrl });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 502);
    }
  }

  if (pathLower === '/api/billing/invoices' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tenantId = await resolveTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant not resolved' }, 400);

    const custRow = await env.DB.prepare(
      `SELECT stripe_customer_id FROM billing_customers WHERE tenant_id = ? LIMIT 1`,
    )
      .bind(tenantId)
      .first();
    const stripeCustomerId = custRow?.stripe_customer_id
      ? String(custRow.stripe_customer_id).trim()
      : '';
    if (!stripeCustomerId) return jsonResponse({ invoices: [] });

    try {
      const list = await stripeRequest(env, 'GET', `/invoices?customer=${encodeURIComponent(stripeCustomerId)}&limit=10`);
      const data = Array.isArray(list?.data) ? list.data : [];
      const invoices = data.map(mapInvoiceSafe).filter(Boolean);
      return jsonResponse({ invoices });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 502);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
