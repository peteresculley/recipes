// Minimal GitHub Contents API client. Each write is one commit on the branch.

export interface GitHubEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/name"
  GITHUB_BRANCH: string;
}

export interface RepoFile {
  path: string;
  sha: string;
  text: string;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh(env: GitHubEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "recipes-mcp",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new GitHubError(res.status, `GitHub API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res;
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function getFile(env: GitHubEnv, path: string): Promise<RepoFile | null> {
  const res = await gh(env, `${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
  if (res.status === 404) return null;
  const data = (await res.json()) as { sha: string; content: string };
  return { path, sha: data.sha, text: decodeBase64(data.content) };
}

/** Creates the file, or updates it when `sha` (the current blob sha) is given. */
export async function putFile(
  env: GitHubEnv,
  path: string,
  text: string,
  message: string,
  sha?: string,
): Promise<void> {
  const res = await gh(env, path, {
    method: "PUT",
    body: JSON.stringify({ message, content: encodeBase64(text), branch: env.GITHUB_BRANCH, sha }),
  });
  if (res.status === 404) throw new GitHubError(404, `Repo or branch not found: ${env.GITHUB_REPO}@${env.GITHUB_BRANCH}`);
}

export async function deleteFile(env: GitHubEnv, path: string, sha: string, message: string): Promise<void> {
  await gh(env, path, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch: env.GITHUB_BRANCH }),
  });
}

/** File names in a directory; empty if the directory does not exist yet. */
export async function listDir(env: GitHubEnv, path: string): Promise<string[]> {
  const res = await gh(env, `${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
  if (res.status === 404) return [];
  const data = (await res.json()) as { name: string; type: string }[];
  return data.filter((e) => e.type === "file").map((e) => e.name);
}
