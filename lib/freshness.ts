import axios from 'axios';
import { githubHeaders } from './github';
import { classifyFileChanges } from './significance';
import GeneratedDocModel from '../models/GeneratedDoc';
import { Types } from 'mongoose';

export type HeadShaResult =
  | { status: 'ok'; sha: string; etag?: string }
  | { status: 'unchanged' }
  | { status: 'github_unavailable' }
  | { status: 'source_unavailable' };

export interface HeadShaInput {
  docId: Types.ObjectId;
  repoId: number;
  repoKey: string;
  defaultBranch: string;
  etag?: string;
}

type RawHeadResult =
  | { status: 'ok'; sha: string; etag?: string }
  | { status: 'unchanged' }
  | { status: 'not_found' }
  | { status: 'github_unavailable' };

const isSuccess = (status: number): boolean => status >= 200 && status < 300;
const isFailOpen = (status: number): boolean =>
  status === 403 || status === 429 || status >= 500;
const accepts = (status: number): boolean =>
  isSuccess(status) || status === 304 || status === 404 || isFailOpen(status);

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (typeof direct === 'string') return direct;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    if (typeof value === 'string') return value;
  }
  return undefined;
}

async function requestHeadSha(
  repoKey: string,
  branch: string,
  etag?: string
): Promise<RawHeadResult> {
  try {
    const res = await axios.get<string>(
      `https://api.github.com/repos/${repoKey}/commits/${encodeURIComponent(branch)}`,
      {
        headers: {
          ...githubHeaders(),
          Accept: 'application/vnd.github.sha',
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
        responseType: 'text',
        transformResponse: [(data: unknown) => data],
        validateStatus: accepts,
      }
    );
    if (res.status === 304) return { status: 'unchanged' };
    if (res.status === 404) return { status: 'not_found' };
    if (isFailOpen(res.status)) return { status: 'github_unavailable' };
    if (!isSuccess(res.status)) return { status: 'github_unavailable' };
    const sha = String(res.data ?? '').trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) return { status: 'github_unavailable' };
    return { status: 'ok', sha, etag: headerValue(res.headers, 'etag') };
  } catch {
    return { status: 'github_unavailable' };
  }
}

async function resolveRepoById(repoId: number): Promise<
  | { status: 'ok'; fullName: string; defaultBranch: string }
  | { status: 'source_unavailable' }
  | { status: 'github_unavailable' }
> {
  try {
    const res = await axios.get<{ full_name: string; default_branch: string }>(
      `https://api.github.com/repositories/${repoId}`,
      {
        headers: githubHeaders(),
        validateStatus: accepts,
      }
    );
    if (res.status === 404) return { status: 'source_unavailable' };
    if (isFailOpen(res.status) || !isSuccess(res.status)) {
      return { status: 'github_unavailable' };
    }
    return {
      status: 'ok',
      fullName: res.data.full_name,
      defaultBranch: res.data.default_branch,
    };
  } catch {
    return { status: 'github_unavailable' };
  }
}

export async function getHeadSha(input: HeadShaInput): Promise<HeadShaResult> {
  const first = await requestHeadSha(input.repoKey, input.defaultBranch, input.etag);

  if (first.status === 'github_unavailable') {
    return { status: 'github_unavailable' };
  }

  if (first.status === 'not_found') {
    const resolved = await resolveRepoById(input.repoId);
    if (resolved.status !== 'ok') return { status: resolved.status };

    const slash = resolved.fullName.indexOf('/');
    const owner = resolved.fullName.slice(0, slash);
    const repo = resolved.fullName.slice(slash + 1);
    const repoKey = resolved.fullName.toLowerCase();
    const defaultBranch = resolved.defaultBranch;

    try {
      await GeneratedDocModel.updateOne(
        { _id: input.docId },
        {
          $set: {
            repoKey,
            repoOwner: owner,
            repoName: repo,
            repoUrl: `https://github.com/${owner}/${repo}`,
            defaultBranch,
          },
        }
      );
    } catch {
      // The rename retry still works even if the bookkeeping update fails;
      // the next lookup falls back to repoId.
    }

    const retry = await requestHeadSha(repoKey, defaultBranch);
    if (retry.status === 'not_found') return { status: 'source_unavailable' };
    if (retry.status === 'github_unavailable') return { status: 'github_unavailable' };
    if (retry.status === 'unchanged') return { status: 'unchanged' };
    return { status: 'ok', sha: retry.sha, etag: retry.etag };
  }

  if (first.status === 'unchanged') return { status: 'unchanged' };
  return { status: 'ok', sha: first.sha, etag: first.etag };
}

export type ClassifyChangeResult =
  | { status: 'ok'; significant: boolean; commitsBehind: number; changedFiles: number }
  | { status: 'github_unavailable' };

const COMPARE_FILE_CAP = 300;

export async function classifyChange(
  repoKey: string,
  oldSha: string,
  newSha: string
): Promise<ClassifyChangeResult> {
  try {
    const res = await axios.get<{
      status?: string;
      total_commits?: number;
      files?: Array<{ filename: string }>;
    }>(
      `https://api.github.com/repos/${repoKey}/compare/${oldSha}...${newSha}`,
      {
        headers: githubHeaders(),
        validateStatus: accepts,
      }
    );

    if (res.status === 404) {
      return { status: 'ok', significant: true, commitsBehind: 0, changedFiles: 0 };
    }
    if (isFailOpen(res.status) || !isSuccess(res.status)) {
      return { status: 'github_unavailable' };
    }

    const data = res.data ?? {};
    const commitsBehind =
      typeof data.total_commits === 'number' && data.total_commits >= 0
        ? data.total_commits
        : 0;
    const files = Array.isArray(data.files) ? data.files : [];
    const truncated = data.status === 'diverged' || files.length >= COMPARE_FILE_CAP;

    if (truncated) {
      return {
        status: 'ok',
        significant: true,
        commitsBehind,
        changedFiles: files.length,
      };
    }

    const { significant } = classifyFileChanges(
      files.map((file) => file.filename)
    );
    return { status: 'ok', significant, commitsBehind, changedFiles: files.length };
  } catch {
    return { status: 'github_unavailable' };
  }
}
