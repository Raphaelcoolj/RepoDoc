import { POST } from '../app/api/generate/route';
import { NextRequest } from 'next/server';
import GeneratedDocModel from '../models/GeneratedDoc';
import UserModel from '../models/User';
import * as github from '../lib/github';
import * as ai from '../lib/ai';
import * as cloudinary from '../lib/cloudinary';
import { auth } from '../auth';

// Mock everything
jest.mock('../models/GeneratedDoc');
jest.mock('../models/User');
jest.mock('../lib/github');
jest.mock('../lib/ai');
jest.mock('../lib/cloudinary');
jest.mock('../auth');
jest.mock('../lib/db', () => ({
  connectDB: jest.fn(),
}));

describe('Doc Generation Pipeline Integration', () => {
  const mockUser = {
    _id: 'user123',
    freeDocsUsed: 0,
    freeDocsResetAt: new Date(),
    apiKeys: {},
    save: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
    (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
  });

  test('CACHE HIT: should return existing doc without calling AI or GitHub', async () => {
    const existingDoc = { slug: 'cached-slug', repoUrl: 'https://github.com/o/r' };
    (GeneratedDocModel.findOne as jest.Mock).mockResolvedValue(existingDoc);

    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/o/r' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(data.slug).toBe('cached-slug');
    expect(data.cached).toBe(true);
    expect(github.fetchRepoFiles).not.toHaveBeenCalled();
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
  });

  test('CACHE MISS: should run full pipeline if doc does not exist', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockResolvedValue(null);
    (github.parseRepoUrl as jest.Mock).mockReturnValue({ owner: 'o', repo: 'r' });
    (github.fetchRepoFiles as jest.Mock).mockResolvedValue({ fileTree: '', keyFiles: {} });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({ fullMarkdown: '# Docs' });
    (cloudinary.uploadMarkdown as jest.Mock).mockResolvedValue('https://cloudinary.com/doc');
    (GeneratedDocModel.create as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/o/r' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(data.cached).toBe(false);
    expect(github.fetchRepoFiles).toHaveBeenCalled();
    expect(ai.generateDocumentation).toHaveBeenCalled();
    expect(cloudinary.uploadMarkdown).toHaveBeenCalled();
    expect(GeneratedDocModel.create).toHaveBeenCalled();
  });

  test('RATE LIMIT: should block if free tier limit reached and no BYOK', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockResolvedValue(null);
    const limitUser = { ...mockUser, freeDocsUsed: 3 };
    (UserModel.findById as jest.Mock).mockResolvedValue(limitUser);

    const req = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify({ repoUrl: 'https://github.com/o/new' }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toContain('limit reached');
  });
});
