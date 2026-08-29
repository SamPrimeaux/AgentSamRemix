/** When iam-pty should POST /api/terminal/assist from PTY output. */

export function shouldAutoAssistOnOutput(cleanD, lastCommand) {
  const cmd = String(lastCommand || "").trim();
  if (cmd.startsWith("#") || cmd.startsWith("//")) return false;
  if (/command not found:\s*#/.test(String(cleanD || ""))) return false;
  return (
    String(cleanD || "").includes("command not found") ||
    String(cleanD || "").includes("npm ERR!") ||
    String(cleanD || "").includes("wrangler:error") ||
    String(cleanD || "").includes("ENOENT") ||
    String(cleanD || "").includes("EACCES") ||
    (String(cleanD || "").includes("Error:") && !String(cleanD || "").includes("// Error:"))
  );
}
