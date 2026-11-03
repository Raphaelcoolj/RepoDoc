import { getHeadSha, classifyChange } from '../lib/freshness';
import GeneratedDocModel from '../models/GeneratedDoc';
import { Types } from 'mongoose';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('../models/GeneratedDoc', () => ({
  __esModule: true,
  default: { updateOne: jest.fn() },
}));

import axios from 'axios';

const axiosGet = axios.get as jest.Mock;
const updateOne = GeneratedDocModel.updateOne as jest.Mock;

const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);

function response(status: number, data: unknown, headers: Record<string, string> = {}) {
  return { status, data, headers };
}

const INPUT = {
  docId: new Types.ObjectId(),
  repoId: 42,
  repoKey: 'owner/repo',
  defaultBranch: 'main',
};

describe('getHeadSha', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns sha and etag on 200', async () => {
    axiosGet.mockResolvedValue(response(200, NEW_SHA, { etag: '"W/abc"' }));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'ok', sha: NEW_SHA, etag: '"W/abc"' });
    const [url, config] = axiosGet.mock.calls[0];
    expect(url).toContain('/repos/owner/repo/commits/main');
    expect(config.headers.Accept).toBe('application/vnd.github.sha');
    expect(config.headers['If-None-Match']).toBeUndefined();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('sends If-None-Match when etag provided', async () => {
    axiosGet.mockResolvedValue(response(304, ''));

    const result = await getHeadSha({ ...INPUT, etag: '"W/abc"' });

    expect(result).toEqual({ status: 'unchanged' });
    const [, config] = axiosGet.mock.calls[0];
    expect(config.headers['If-None-Match']).toBe('"W/abc"');
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('rate limit fails open', async () => {
    axiosGet.mockResolvedValue(response(403, 'forbidden', { 'x-ratelimit-remaining': '0' }));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('429 fails open', async () => {
    axiosGet.mockResolvedValue(response(429, 'rate limited'));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('network error fails open', async () => {
    axiosGet.mockRejectedValue(new Error('ECONNRESET'));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('5xx fails open', async () => {
    axiosGet.mockResolvedValue(response(502, 'bad gateway'));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('rename: 404 re-resolves by repoId, updates doc, retries', async () => {
    axiosGet
      .mockResolvedValueOnce(response(404, 'not found'))
      .mockResolvedValueOnce(
        response(200, { full_name: 'new-owner/repo', default_branch: 'trunk' })
      )
      .mockResolvedValueOnce(response(200, NEW_SHA, { etag: '"W/new"' }));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'ok', sha: NEW_SHA, etag: '"W/new"' });
    expect(axiosGet.mock.calls[1][0]).toContain('/repositories/42');
    expect(axiosGet.mock.calls[2][0]).toContain('/repos/new-owner/repo/commits/trunk');
    expect(updateOne).toHaveBeenCalledWith(
      { _id: INPUT.docId },
      {
        $set: {
          repoKey: 'new-owner/repo',
          repoOwner: 'new-owner',
          repoName: 'repo',
          repoUrl: 'https://github.com/new-owner/repo',
          defaultBranch: 'trunk',
        },
      }
    );
  });

  test('deleted repo: 404 then 404 → source_unavailable', async () => {
    axiosGet
      .mockResolvedValueOnce(response(404, 'not found'))
      .mockResolvedValueOnce(response(404, 'not found'));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'source_unavailable' });
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('rename resolve rate-limited → github_unavailable (fail-open)', async () => {
    axiosGet
      .mockResolvedValueOnce(response(404, 'not found'))
      .mockResolvedValueOnce(response(403, 'rate limited', { 'x-ratelimit-remaining': '0' }));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('invalid sha body → github_unavailable', async () => {
    axiosGet.mockResolvedValue(response(200, '<html>oops</html>'));

    const result = await getHeadSha(INPUT);

    expect(result).toEqual({ status: 'github_unavailable' });
  });
});

describe('classifyChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('insignificant when only ignored files changed', async () => {
    axiosGet.mockResolvedValue(
      response(200, {
        status: 'ahead',
        total_commits: 4,
        files: [
          { filename: 'README.md' },
          { filename: 'CHANGELOG.md' },
          { filename: 'dist/bundle.js' },
          { filename: 'docs/a.md' },
          { filename: 'logo.png' },
        ],
      })
    );

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result).toEqual({
      status: 'ok',
      significant: false,
      commitsBehind: 4,
      changedFiles: 5,
    });
    expect(axiosGet.mock.calls[0][0]).toContain(
      `/compare/${OLD_SHA}...${NEW_SHA}`
    );
  });

  test('significant when threshold of non-ignored files met', async () => {
    axiosGet.mockResolvedValue(
      response(200, {
        status: 'ahead',
        total_commits: 2,
        files: [{ filename: 'a.ts' }, { filename: 'b.ts' }, { filename: 'c.ts' }],
      })
    );

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result).toEqual({
      status: 'ok',
      significant: true,
      commitsBehind: 2,
      changedFiles: 3,
    });
  });

  test('manifest change alone is significant', async () => {
    axiosGet.mockResolvedValue(
      response(200, {
        status: 'ahead',
        total_commits: 1,
        files: [{ filename: 'package.json' }],
      })
    );

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.significant).toBe(true);
  });

  test('compare 404 (force-push) → significant', async () => {
    axiosGet.mockResolvedValue(response(404, 'not found'));

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result).toEqual({
      status: 'ok',
      significant: true,
      commitsBehind: 0,
      changedFiles: 0,
    });
  });

  test('diverged compare → significant regardless of file list', async () => {
    axiosGet.mockResolvedValue(
      response(200, {
        status: 'diverged',
        total_commits: 7,
        files: [{ filename: 'README.md' }],
      })
    );

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.significant).toBe(true);
  });

  test('truncated file list (300 files) → significant', async () => {
    axiosGet.mockResolvedValue(
      response(200, {
        status: 'ahead',
        total_commits: 10,
        files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.md` })),
      })
    );

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.significant).toBe(true);
      expect(result.changedFiles).toBe(300);
    }
  });

  test('rate limit fails open', async () => {
    axiosGet.mockResolvedValue(response(403, 'forbidden'));

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result).toEqual({ status: 'github_unavailable' });
  });

  test('network error fails open', async () => {
    axiosGet.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await classifyChange('owner/repo', OLD_SHA, NEW_SHA);

    expect(result).toEqual({ status: 'github_unavailable' });
  });
});
