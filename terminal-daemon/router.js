/**
 * ExecOS — Intent Router
 * Returns route + confidence for any terminal input.
 * Routes: shell_direct | chat_local | hybrid | agent_cloud
 */

const AGENT_PREFIX  = /^(@agentsam|hey\s+agentsam|agentsam:|@agent\b|agent:|\/agentsam\b|\/agent\b)/i;
const SLASH_CHAT    = /^\/(ask|explain|fix|help)\b/i;
const SHELL_BINS    = /^(cd|ls|ll|la|git|npm|npx|node|python3?|pip3?|curl|wget|cat|grep|find|mkdir|rmdir|rm|cp|mv|touch|echo|export|source|which|wrangler|pm2|ssh|scp|open|code|brew|kill|ps|top|df|du|chmod|chown|ln|tar|zip|unzip|sed|awk|sort|head|tail|less|more|vi|vim|nano|diff|patch|make|\.\/|\/usr|\/bin|\/opt|\/etc|\/home|~\/)/i;
const SHELL_OPS     = /^[^?]*[|&;><`]/;
const CHAT_STARTERS = /^(why|how|what|when|where|who|is |are |can |could |should |would |will |does |do |explain|help|fix|debug|check|show|tell|list|describe|compare|diff|error|fail|broken|issue|problem|wrong|not work|whats|what's|i (get|see|have)|getting|seeing|having)/i;
const HYBRID_IND    = /\b(file|function|component|route|endpoint|table|column|query|deploy|worker|binding|migration|hook|module|import|export|class|type|interface|schema|api|error|bug|crash|fail|broken|undefined|null|cannot|can't|won't|doesn't)\b/i;
const CLOUD_IND     = /\b(refactor|architect|design|migrate|rewrite|scaffold|restructure|plan|strategy|across (all|multiple|every)|entire (codebase|repo|project)|from scratch)\b/i;

export function routeInput(raw, session) {
  const t = raw.trim();
  if (!t) return { route: 'shell_direct', confidence: 1.0, query: t };

  if (AGENT_PREFIX.test(t)) {
    return { route: 'agent_cloud', confidence: 1.0, query: t.replace(AGENT_PREFIX, '').trim() };
  }
  if (SLASH_CHAT.test(t)) {
    return { route: 'chat_local', confidence: 1.0, query: t.replace(/^\/\w+\s*/, '').trim() || session?.lastCommand || '' };
  }
  if (SHELL_BINS.test(t)) return { route: 'shell_direct', confidence: 0.95, query: t };
  if (SHELL_OPS.test(t) && t.length < 120) return { route: 'shell_direct', confidence: 0.9, query: t };
  if (!t.includes(' ')) return { route: 'shell_direct', confidence: 0.85, query: t };
  if (CLOUD_IND.test(t)) return { route: 'agent_cloud', confidence: 0.85, query: t };
  if (CHAT_STARTERS.test(t) && HYBRID_IND.test(t)) return { route: 'hybrid', confidence: 0.8, query: t };
  if (CHAT_STARTERS.test(t)) return { route: 'chat_local', confidence: 0.75, query: t };
  if (HYBRID_IND.test(t) && t.split(' ').length >= 3) return { route: 'hybrid', confidence: 0.7, query: t };
  if (t.split(' ').length >= 3) return { route: 'chat_local', confidence: 0.6, query: t };
  return { route: 'shell_direct', confidence: 0.6, query: t };
}
