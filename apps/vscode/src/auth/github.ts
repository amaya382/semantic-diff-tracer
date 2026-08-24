import * as vscode from 'vscode';

const SCOPES = ['repo'];

export async function getGithubAccessToken(): Promise<string> {
  const session = await vscode.authentication.getSession('github', SCOPES, {
    createIfNone: true,
  });
  return session.accessToken;
}
