/**
 * BlueBubbles is retired. iMessage goes through D1 + Mac Messages.app:
 *   agentsam_imessage_send / request_approval / approval_status
 *   scripts/imessage/imessage_approval_daemon.py
 */
function retired() {
  throw new Error(
    'bluebubbles_retired: use agentsam_imessage_send / agentsam_imessage_request_approval (Mac Messages.app daemon)',
  );
}

export async function bbRequest() {
  retired();
}
export async function sendMessage() {
  retired();
}
export async function listChats() {
  retired();
}
export async function getMessages() {
  retired();
}
export async function ping() {
  retired();
}
