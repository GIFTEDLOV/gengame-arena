export function displayName(username: string | null | undefined, address: string): string {
  if (username) return `@${username}`;
  return `Anonymous (${address.slice(0, 6)}...${address.slice(-4)})`;
}
