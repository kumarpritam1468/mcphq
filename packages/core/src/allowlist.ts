/**
 * mcphq-maintained trust layer on top of the official registry, which accepts
 * any publisher. Trust is by repository owner, not per-server audit — mcphq
 * doesn't vet every server in these orgs, it trusts who's allowed to push there.
 */
export const TRUSTED_REPOSITORY_PREFIXES: readonly string[] = [
  "https://github.com/modelcontextprotocol/",
  "https://github.com/anthropics/",
  "https://github.com/github/",
  "https://github.com/microsoft/",
  "https://github.com/google/",
  "https://github.com/googleapis/",
  "https://github.com/cloudflare/",
  "https://github.com/stripe/",
  "https://github.com/upstash/",
];

export function isAllowlisted(repositoryUrl: string | undefined): boolean {
  if (!repositoryUrl) return false;
  return TRUSTED_REPOSITORY_PREFIXES.some((prefix) =>
    repositoryUrl.startsWith(prefix),
  );
}
