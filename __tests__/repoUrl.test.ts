import { canonicalizeRepoUrl, InvalidRepoUrlError } from '../lib/repoUrl';

describe('canonicalizeRepoUrl', () => {
  const valid: Array<[string, { owner: string; repo: string; repoKey: string }]> = [
    ['https://github.com/owner/repo', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo.git', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo/', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://www.github.com/Owner/Repo', { owner: 'Owner', repo: 'Repo', repoKey: 'owner/repo' }],
    ['https://github.com/Owner/Repo/tree/main', { owner: 'Owner', repo: 'Repo', repoKey: 'owner/repo' }],
    ['https://github.com/Owner/Repo/blob/main/src/index.ts', { owner: 'Owner', repo: 'Repo', repoKey: 'owner/repo' }],
    ['github.com/owner/repo', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo?tab=readme-ov', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo#readme', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['http://github.com/owner/repo', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo.git/', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['HTTPS://GITHUB.COM/Owner/Repo', { owner: 'Owner', repo: 'Repo', repoKey: 'owner/repo' }],
    ['https://github.com/owner/repo/tree/feature/branch', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
    ['  https://github.com/owner/repo  ', { owner: 'owner', repo: 'repo', repoKey: 'owner/repo' }],
  ];

  test.each(valid)('accepts %s', (input, expected) => {
    expect(canonicalizeRepoUrl(input)).toEqual(expected);
  });

  const invalid = [
    '',
    '   ',
    'https://notgithub.com/owner/repo',
    'https://www.gitlab.com/owner/repo',
    'https://github.com.evil.com/owner/repo',
    'https://gist.github.com/owner/repo',
    'https://github.com/owner',
    'https://github.com/',
    'https://github.com/owner/.git',
    'not a url at all',
  ];

  test.each(invalid)('rejects %j', (input) => {
    expect(() => canonicalizeRepoUrl(input)).toThrow(InvalidRepoUrlError);
  });

  test('rejects with the legacy error message', () => {
    expect(() => canonicalizeRepoUrl('https://gitlab.com/o/r')).toThrow(
      'Invalid GitHub repository URL'
    );
  });

  test('lowercases repoKey but preserves owner/repo casing', () => {
    const result = canonicalizeRepoUrl('https://github.com/FaceBook/React');
    expect(result.owner).toBe('FaceBook');
    expect(result.repo).toBe('React');
    expect(result.repoKey).toBe('facebook/react');
  });
});
