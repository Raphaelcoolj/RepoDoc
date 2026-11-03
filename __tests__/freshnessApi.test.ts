import { GET } from '../app/api/doc/[slug]/freshness/route';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import GeneratedDocModel from '../models/GeneratedDoc';
import * as freshness from '../lib/freshness';

jest.mock('../models/GeneratedDoc');
jest.mock('../lib/freshness');
jest.mock('../lib/db', () => ({ connectDB: jest.fn() }));

const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);

const DOC = {
  _id: new Types.ObjectId('64b000000000000000000002'),
  slug: 'fresh-doc',
  repoKey: 'o/r',
  repoId: 12345,
  defaultBranch: 'main',
  commitSha: OLD_SHA,
  etag: 'W/"old"',
  lastKnownHeadSha: OLD_SHA,
  commitsBehind: 0,
  lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
  lastRegeneratedAt: new Date('2025-12-01T00:00:00Z'),
  status: 'ready',
  version: 3,
};

function leanResult(value: unknown): { lean: () => Promise<unknown> } {
  return { lean: () => Promise.resolve(value) };
}

function get(slug = 'fresh-doc'): Promise<Response> {
  const req = new NextRequest('http://localhost/api/doc/fresh-doc/freshness');
  return GET(req, { params: Promise.resolve({ slug }) });
}

describe('GET /api/doc/[slug]/freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: OLD_SHA,
      etag: 'W/"old"',
    });
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'ok',
      significant: false,
      commitsBehind: 4,
      changedFiles: 6,
    });
  });

  it('returns 404 for an unknown slug', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(null));

    const res = await get('missing');

    expect(res.status).toBe(404);
    expect(freshness.getHeadSha).not.toHaveBeenCalled();
  });

  it('reports regenerating without calling GitHub', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(
      leanResult({ ...DOC, status: 'generating' })
    );

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('regenerating');
    expect(data.version).toBe(3);
    expect(freshness.getHeadSha).not.toHaveBeenCalled();
  });

  it('reports unknown for a legacy doc without a baseline sha', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(
      leanResult({ ...DOC, commitSha: undefined })
    );

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('unknown');
    expect(freshness.getHeadSha).not.toHaveBeenCalled();
  });

  it('reports up_to_date when the head matches the baseline', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));

    const res = await get();
    const data = await res.json();

    expect(data).toMatchObject({
      status: 'up_to_date',
      commitsBehind: 0,
      version: 3,
      lastRegeneratedAt: '2025-12-01T00:00:00.000Z',
      lastCheckedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(freshness.classifyChange).not.toHaveBeenCalled();
  });

  it('reports up_to_date on a 304 when snapshots agree', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'unchanged',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('up_to_date');
    expect(data.commitsBehind).toBe(0);
  });

  it('reports behind on a 304 when the doc lags the stored head', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(
      leanResult({
        ...DOC,
        lastKnownHeadSha: NEW_SHA,
        commitsBehind: 7,
      })
    );
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'unchanged',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('behind');
    expect(data.commitsBehind).toBe(7);
  });

  it('classifies a moved head and reports how far behind', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('behind');
    expect(data.commitsBehind).toBe(4);
    expect(freshness.classifyChange).toHaveBeenCalledWith(
      'o/r',
      OLD_SHA,
      NEW_SHA
    );
  });

  it('reports unknown when GitHub is unavailable (fail-open)', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'github_unavailable',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('unknown');
  });

  it('reports unknown when classification fails', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'github_unavailable',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('unknown');
  });

  it('reports source_unavailable when the repo is gone', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'source_unavailable',
    });

    const res = await get();
    const data = await res.json();

    expect(data.status).toBe('source_unavailable');
  });

  it('sets a short public cache header', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));

    const res = await get();

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });
});
