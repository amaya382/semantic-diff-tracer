import * as readline from 'node:readline/promises';

let rl: readline.Interface | undefined;

function getInterface(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

export async function ask(question: string): Promise<string> {
  return getInterface().question(question);
}

export function close(): void {
  rl?.close();
  rl = undefined;
}
