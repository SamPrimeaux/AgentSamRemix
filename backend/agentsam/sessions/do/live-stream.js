const encoder = new TextEncoder();

function registry(session, key) {
  if (!session[key]) session[key] = new Map();
  return session[key];
}

export function addSubscriber(session, registryKey, topic, subscriber) {
  const reg = registry(session, registryKey);
  let set = reg.get(topic);
  if (!set) {
    set = new Set();
    reg.set(topic, set);
  }
  set.add(subscriber);
  return () => {
    set.delete(subscriber);
    if (set.size === 0) reg.delete(topic);
  };
}

export function publishToTopic(session, registryKey, topic, frame, opts = {}) {
  const set = session[registryKey]?.get(topic);
  if (!set?.size) return 0;
  let delivered = 0;
  for (const sub of [...set]) {
    try {
      sub.controller.enqueue(encoder.encode(frame));
      delivered += 1;
      if (opts.close === true) {
        sub.controller.close();
        sub.cleanup?.();
      }
    } catch {
      sub.cleanup?.();
    }
  }
  return delivered;
}

export function createKeepalive(subscriber, intervalMs = 15000) {
  const timer = setInterval(() => {
    try { subscriber.controller.enqueue(encoder.encode(': keepalive\n\n')); }
    catch { subscriber.cleanup?.(); }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function encodeFrame(text) {
  return encoder.encode(text);
}
