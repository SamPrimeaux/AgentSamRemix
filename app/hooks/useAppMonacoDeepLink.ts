/** Monaco MCP-tool deep-link opener (Wave 2). */
import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { AGENT_HOME_PATH, isAgentHomePath } from '../lib/agentRoutes';
import { prepareActiveFileForEditor } from '../src/lib/prepareActiveFileForEditor';
import type { ActiveFile } from '../types';

export function useAppMonacoDeepLink(opts: {
  locationPathname: string;
  locationSearch: string;
  navigate: NavigateFunction;
  openFile: (f: ActiveFile) => void;
}) {
  const { locationPathname, locationSearch, navigate, openFile } = opts;
  useEffect(() => {
    if (!isAgentHomePath(locationPathname)) return;
    const search = locationSearch || '';
    if (!search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const monaco = params.get('monaco');
    if (monaco !== 'mcp_tool') return;

    const id = params.get('id') || 'tool';
    const payload = params.get('payload') || '';
    if (!payload) return;

    let decoded = payload;
    try {
      decoded = decodeURIComponent(payload);
    } catch {
      decoded = payload;
    }

    const content = decoded.length > 250_000 ? decoded.slice(0, 250_000) : decoded;
    const name = `mcp_tool_${id}.json`;

    openFile(
      prepareActiveFileForEditor({
        name,
        workspacePath: `mcp_tool:${id}`,
        content,
        source_type: 'mcp_tool',
      }),
    );

    try {
      navigate(AGENT_HOME_PATH, { replace: true });
    } catch {
      // ignore
    }
  }, [locationPathname, locationSearch, navigate, openFile]);
}
