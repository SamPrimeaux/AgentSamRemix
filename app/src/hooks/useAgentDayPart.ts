import { useEffect, useState } from 'react';
import { dayPartFromHour, type AgentDayPart } from '../../lib/agentDayPart';

export function useAgentDayPart(): AgentDayPart {
  const [part, setPart] = useState<AgentDayPart>(() => dayPartFromHour(new Date().getHours()));

  useEffect(() => {
    const tick = () => setPart(dayPartFromHour(new Date().getHours()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return part;
}
