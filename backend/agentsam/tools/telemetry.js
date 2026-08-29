/**
 * Tool: Telemetry (Logging / Analytics)
 * Implements 3 tools for system observability and health tracking.
 */

export const handlers = {
    /**
     * telemetry_log: Record tool execution details.
     */
    async telemetry_log(params, env) {
        if (!env.DB) return { error: 'DB not configured' };
        try {
            await env.DB.prepare(
                `INSERT INTO mcp_tool_usage (tool_name, status, duration_ms, error_message, metadata_json, created_at) 
                 VALUES (?, ?, ?, ?, ?, datetime('now'))`
            ).bind(params.tool_name, params.status, params.duration_ms || 0, params.error, JSON.stringify(params.metadata || {})).run();
            return { success: true };
        } catch (e) {
            return { error: `Logging Failed: ${e.message}` };
        }
    },

    /**
     * telemetry_query: Fetch recent tool-use historical data.
     */
    async telemetry_query(params, env) {
        if (!env.DB) return { error: 'DB not configured' };
        try {
            const { results } = await env.DB.prepare(
                "SELECT * FROM mcp_tool_usage WHERE (tool_name = ? OR ? = '*') ORDER BY created_at DESC LIMIT ?"
            ).bind(params.tool_name || '*', params.tool_name || '*', params.limit || 10).all();
            return { results };
        } catch (e) {
            return { error: `Telemetry Query Failed: ${e.message}` };
        }
    },

    /**
     * telemetry_stats: High-level usage and performance metrics.
     */
    async telemetry_stats(params, env) {
        if (!env.DB) return { error: 'DB not configured' };
        try {
            const stats = await env.DB.prepare(
                "SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM mcp_tool_usage GROUP BY tool_name"
            ).all();
            return { stats: stats.results };
        } catch (e) {
            return { error: `Stats Generation Failed: ${e.message}` };
        }
    }
};
