export type BridgeHttpUrl = (path: string, query?: URLSearchParams) => string;

export async function apiErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Fall through to the status-based error.
  }
  return null;
}
