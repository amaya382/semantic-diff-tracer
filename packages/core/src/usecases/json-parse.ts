export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  throw new Error('No JSON object found in LLM response');
}

export function parseJsonStrict<T>(text: string): T {
  const raw = extractJson(text);
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse LLM JSON: ${(e as Error).message}\n---\n${raw.slice(0, 500)}`,
    );
  }
}
