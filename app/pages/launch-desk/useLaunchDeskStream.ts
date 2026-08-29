import { useCallback, useMemo, useRef, useState } from 'react';

export interface LaunchDeskInput {
  brief: string;
  audience: string;
  launchDate: string;
  constraints: string;
  availableAssets: string;
}

export interface LaunchDeskStreamEvent {
  event: string;
  payload: Record<string, unknown>;
}

function parseSseBlock(block: string): LaunchDeskStreamEvent | null {
  const lines = block.split(/\r?\n/).filter(Boolean);
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, payload: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
  } catch {
    return { event, payload: { raw: dataLines.join('\n') } };
  }
}

export function useLaunchDeskStream() {
  const abortRef = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<LaunchDeskStreamEvent[]>([]);
  const [streamText, setStreamText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const [readinessScore, setReadinessScore] = useState<number | null>(null);
  const [sawToolEvent, setSawToolEvent] = useState(false);
  const [sawTextDelta, setSawTextDelta] = useState(false);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async (input: LaunchDeskInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEvents([]);
    setStreamText('');
    setFinalText('');
    setError(null);
    setLastToolName(null);
    setReadinessScore(null);
    setSawToolEvent(false);
    setSawTextDelta(false);
    setIsStreaming(true);

    try {
      const response = await fetch('/api/launch-desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Launch Desk API failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });

        let boundary = carry.indexOf('\n\n');
        while (boundary !== -1) {
          const block = carry.slice(0, boundary).trim();
          carry = carry.slice(boundary + 2);
          boundary = carry.indexOf('\n\n');
          if (!block) continue;
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          setEvents((prev) => [...prev, parsed]);

          const payload = parsed.payload;
          if (parsed.event === 'tool_progress') {
            setSawToolEvent(true);
            if (typeof payload.name === 'string' && payload.name.trim()) setLastToolName(payload.name.trim());
          }
          if (parsed.event === 'text_delta' && typeof payload.delta === 'string') {
            setSawTextDelta(true);
            setStreamText((prev) => `${prev}${payload.delta}`);
          }
          if (parsed.event === 'final_output' && typeof payload.text === 'string') {
            setFinalText(payload.text);
            if (typeof payload.sawTool === 'boolean') setSawToolEvent(payload.sawTool);
            if (typeof payload.sawText === 'boolean') setSawTextDelta(payload.sawText);
          }
          if (parsed.event === 'status' && typeof payload.readiness_score === 'number') {
            setReadinessScore(payload.readiness_score);
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const renderedText = useMemo(() => finalText || streamText, [finalText, streamText]);

  return {
    run,
    cancel,
    events,
    renderedText,
    streamText,
    finalText,
    isStreaming,
    error,
    lastToolName,
    readinessScore,
    sawToolEvent,
    sawTextDelta,
  };
}
