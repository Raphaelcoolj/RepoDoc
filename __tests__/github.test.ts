import { parseRepoUrl } from '../lib/github';

describe('GitHub URL Parser', () => {
  test('should parse standard GitHub URLs', () => {
    const url = 'https://github.com/owner/repo';
    const result = parseRepoUrl(url);
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('should parse URLs with .git suffix', () => {
    const url = 'https://github.com/owner/repo.git';
    const result = parseRepoUrl(url);
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('should parse URLs with trailing slash', () => {
    const url = 'https://github.com/owner/repo/';
    const result = parseRepoUrl(url);
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('should throw on invalid URLs', () => {
    const url = 'https://notgithub.com/owner/repo';
    expect(() => parseRepoUrl(url)).toThrow('Invalid GitHub repository URL');
  });
});
