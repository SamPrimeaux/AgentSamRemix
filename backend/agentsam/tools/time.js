// backend/agentsam/tools/time.js
/**
 * Agent Sam: Time & Temporal Dispatcher
 * Orchestrates time-aware logic and timezone conversions.
 */
import { httpJsonResponse as jsonResponse } from '../../http/responses.js';

const DEFAULT_TIMEZONE = 'UTC';

function normalizeTimezone(value) {
    const timezone = String(value || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return timezone;
    } catch {
        throw new Error(`Invalid timezone: ${timezone}`);
    }
}

export function getCurrentTime({ timezone = DEFAULT_TIMEZONE, now = new Date() } = {}) {
    const resolvedTimezone = normalizeTimezone(timezone);
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
    return {
        iso: date.toISOString(),
        timestamp: Math.floor(date.getTime() / 1000),
        local: date.toLocaleString('en-US', { timeZone: resolvedTimezone }),
        timezone: resolvedTimezone,
    };
}

export function convertTime({ time, targetTimezone = DEFAULT_TIMEZONE } = {}) {
    if (!time) throw new Error('Missing time parameter');
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
    const timezone = normalizeTimezone(targetTimezone);
    return {
        original: date.toISOString(),
        converted: date.toLocaleString('en-US', { timeZone: timezone }),
        target_timezone: timezone,
    };
}

/**
 * Main dispatcher for Time-related tasks.
 * Route: /api/agentsam/time/*
 */
export async function handleTimeDispatch(request, env, ctx, authUser) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
        const body = method !== 'GET' ? await request.json() : {};
        const timezone = body.timezone || url.searchParams.get('timezone') || DEFAULT_TIMEZONE;

        // 1. NOW: Get current time
        if (path.endsWith('/now')) {
            return jsonResponse(getCurrentTime({ timezone }));
        }

        // 2. CONVERT: Timezone conversion logic
        if (path.endsWith('/convert')) {
            return jsonResponse(convertTime({
                time: body.time || url.searchParams.get('time'),
                targetTimezone:
                    body.target_timezone ||
                    url.searchParams.get('target_timezone') ||
                    DEFAULT_TIMEZONE,
            }));
        }

        return jsonResponse({ error: 'Time action not found' }, 404);

    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const clientError =
            message.startsWith('Invalid timezone') ||
            message === 'Missing time parameter' ||
            message === 'Invalid date';
        console.error('[Time Dispatch Error]', message);
        return jsonResponse(
            { error: clientError ? message : 'Time dispatcher failed', detail: message },
            clientError ? 400 : 500,
        );
    }
}
