// Pure search, aliasing, and ranking utilities for the global CommandPalette.

export interface SearchablePaletteItem {
  id: string;
  name: string;
  description: string;
  category?: string;
  keywords?: string[];
  icon: string;
  action: () => void;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function scoreItem(item: SearchablePaletteItem, normalizedQuery: string, tokens: string[]): number {
  const normName = normalizeSearchText(item.name);
  const normId = normalizeSearchText(item.id);
  const normIdWords = normalizeSearchText(item.id.replace(/[-_]+/g, ' '));
  const normDesc = normalizeSearchText(item.description);
  const normCat = normalizeSearchText(item.category ?? '');
  const normKeywords = (item.keywords ?? []).map(normalizeSearchText).filter(Boolean);

  const combined = [normName, normId, normIdWords, normCat, normDesc, ...normKeywords]
    .filter(Boolean)
    .join(' ');

  if (!tokens.every((token) => combined.includes(token))) {
    return -1;
  }

  let score = 100;

  if (normName === normalizedQuery || normId === normalizedQuery || normIdWords === normalizedQuery) {
    score += 1000;
  } else if (normName.startsWith(normalizedQuery) || normId.startsWith(normalizedQuery)) {
    score += 700;
  } else if (normName.includes(normalizedQuery)) {
    score += 500;
  } else if (normKeywords.some((kw) => kw === normalizedQuery)) {
    score += 420;
  } else if (normKeywords.some((kw) => kw.startsWith(normalizedQuery))) {
    score += 320;
  }

  const nameOrIdWords = [normName, normId, normIdWords].join(' ');
  const keywordWords = normKeywords.join(' ');

  let nameTokenHits = 0;
  let keywordTokenHits = 0;
  for (const token of tokens) {
    if (nameOrIdWords.includes(token)) {
      nameTokenHits += 1;
    } else if (keywordWords.includes(token)) {
      keywordTokenHits += 1;
    }
  }

  score += nameTokenHits * 60 + keywordTokenHits * 30;
  return score;
}

/**
 * Filters, deduplicates by item id, and ranks palette items for tokenized queries.
 */
export function filterAndRankPaletteItems<T extends SearchablePaletteItem>(
  items: T[],
  query: string,
): T[] {
  const deduped: T[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      deduped.push(item);
    }
  }

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return deduped;
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const scored: Array<{ item: T; score: number; index: number }> = [];

  deduped.forEach((item, index) => {
    const score = scoreItem(item, normalizedQuery, tokens);
    if (score >= 0) {
      scored.push({ item, score, index });
    }
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}
