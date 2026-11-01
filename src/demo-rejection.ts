/** Recognize only the structured, explicit OKX permission rejection. */
export function isExplicitDemoPermissionRejection(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const error = (result as Record<string, unknown>).error;
  if (typeof error !== "string" || !error.startsWith("okx ")) return false;
  try {
    const data = JSON.parse(error.slice(4)) as { code?: unknown; msg?: unknown };
    return data.code === "50123" && typeof data.msg === "string" && data.msg.includes("does not have trading permission");
  } catch { return false; }
}
