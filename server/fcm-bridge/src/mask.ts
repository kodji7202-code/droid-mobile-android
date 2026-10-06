/** Shortened form of an FCM token for logs: enough to tell tokens apart, never usable. */
export function maskToken(token: string): string {
  if (token.length <= 16) return `***(${token.length})`;
  return `${token.slice(0, 4)}...${token.slice(-4)}(${token.length})`;
}
