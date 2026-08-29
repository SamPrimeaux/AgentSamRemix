export async function handlePostMessage(session, request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const {
    id, turn_id = null, role, content, status = 'complete', error = null,
    model_used = null, input_tokens = 0, output_tokens = 0, tool_calls = null,
  } = body || {};
  if (!role || typeof content !== 'string') {
    return Response.json({ ok: false, error: 'missing_role_or_content' }, { status: 400 });
  }
  const messageId = id || crypto.randomUUID();
  const toolCallsJson = tool_calls ? JSON.stringify(tool_calls) : null;
  session.sql.exec(
    `INSERT INTO session_messages
       (id, turn_id, role, content, status, error, model_used, input_tokens, output_tokens, tool_calls, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content, status = excluded.status, error = excluded.error,
       model_used = excluded.model_used, input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens, tool_calls = excluded.tool_calls,
       updated_at = unixepoch()`,
    messageId, turn_id, role, content, status, error, model_used,
    Number(input_tokens) || 0, Number(output_tokens) || 0, toolCallsJson,
  );
  return Response.json({ ok: true, id: messageId });
}

export async function handlePatchMessage(session, id, request) {
  if (!id) return Response.json({ ok: false, error: 'missing_id' }, { status: 400 });
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  const { status, error = null, output_tokens, content } = body || {};
  if (!status) return Response.json({ ok: false, error: 'missing_status' }, { status: 400 });
  if (typeof content === 'string') {
    session.sql.exec(
      `UPDATE session_messages SET status = ?, error = ?, content = ?,
       output_tokens = COALESCE(?, output_tokens), updated_at = unixepoch() WHERE id = ?`,
      status, error, content, output_tokens != null ? Number(output_tokens) : null, id,
    );
  } else {
    session.sql.exec(
      `UPDATE session_messages SET status = ?, error = ?,
       output_tokens = COALESCE(?, output_tokens), updated_at = unixepoch() WHERE id = ?`,
      status, error, output_tokens != null ? Number(output_tokens) : null, id,
    );
  }
  return Response.json({ ok: true });
}

export async function handleGetHistory(session, url) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);
  const cursor = url.searchParams.get('before');
  const rows = cursor
    ? [...session.sql.exec(`SELECT * FROM session_messages WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`, Number(cursor), limit)]
    : [...session.sql.exec(`SELECT * FROM session_messages ORDER BY created_at DESC LIMIT ?`, limit)];
  const messages = rows.reverse().map((r) => ({
    ...r,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : null,
  }));
  return Response.json({ messages });
}
