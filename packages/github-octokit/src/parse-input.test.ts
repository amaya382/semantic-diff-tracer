import { describe, expect, it } from 'vitest';
import {
  parseGithubPrUrl,
  parseNumberOnly,
  parseOwnerRepoNumber,
  parseRemoteUrl,
} from './parse-input.js';

describe('parseGithubPrUrl', () => {
  it('accepts canonical PR urls', () => {
    expect(parseGithubPrUrl('https://github.com/foo/bar/pull/42')).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 42,
    });
  });
  it('rejects non-PR paths', () => {
    expect(parseGithubPrUrl('https://github.com/foo/bar/issues/42')).toBeNull();
  });
});

describe('parseOwnerRepoNumber', () => {
  it('accepts owner/repo#N', () => {
    expect(parseOwnerRepoNumber('foo/bar#42')).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 42,
    });
  });
});

describe('parseNumberOnly', () => {
  it('needs a default repo to resolve', () => {
    expect(parseNumberOnly('#42')).toBeNull();
    expect(parseNumberOnly('42')).toBeNull();
  });
  it('resolves against default repo', () => {
    expect(parseNumberOnly('#42', { owner: 'foo', repo: 'bar' })).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 42,
    });
    expect(parseNumberOnly('42', { owner: 'foo', repo: 'bar' })).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 42,
    });
  });
});

describe('parseRemoteUrl', () => {
  it('parses ssh remotes', () => {
    expect(parseRemoteUrl('git@github.com:foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    expect(parseRemoteUrl('git@github.com:foo/bar')).toEqual({ owner: 'foo', repo: 'bar' });
  });
  it('parses https remotes', () => {
    expect(parseRemoteUrl('https://github.com/foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    expect(parseRemoteUrl('https://github.com/foo/bar/')).toEqual({ owner: 'foo', repo: 'bar' });
  });
  it('returns null for non-github', () => {
    expect(parseRemoteUrl('https://gitlab.com/foo/bar')).toBeNull();
  });
});
