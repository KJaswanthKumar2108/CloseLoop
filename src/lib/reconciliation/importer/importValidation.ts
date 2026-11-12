/**
 * Strips UTF-8 Byte Order Mark (BOM) if present.
 */
export function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * Normalize header names (lowercase, stripped of spaces and symbols) for fuzzy comparison.
 */
export function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[\s_\-–—()[\].]/g, '');
}

/**
 * Resolves a canonical column name from candidate variants.
 */
export function resolveColumn(
  headers: string[],
  candidateVariants: string[]
): { canonicalHeader: string; rawHeader: string } | null {
  const normalizedCandidateMap = new Map<string, string>();
  for (const variant of candidateVariants) {
    normalizedCandidateMap.set(normalizeHeaderKey(variant), variant);
  }

  for (const header of headers) {
    const norm = normalizeHeaderKey(header);
    if (normalizedCandidateMap.has(norm)) {
      return {
        canonicalHeader: normalizedCandidateMap.get(norm)!,
        rawHeader: header,
      };
    }
  }

  return null;
}

/**
 * Validates and normalizes timestamp strings into ISO 8601 format.
 */
export function parseAndValidateIsoTimestamp(
  rawDate: string,
  rawTime?: string
): string | null {
  const combined = rawTime ? `${rawDate.trim()} ${rawTime.trim()}` : rawDate.trim();
  if (!combined) return null;

  // Try standard Date parsing
  const parsed = new Date(combined);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Handle common formats like DD/MM/YYYY or MM/DD/YYYY
  const parts = combined.split(/[\sT]+/);
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';

  const dateSub = datePart.split(/[/.-]/);
  if (dateSub.length === 3) {
    // If year is first (YYYY-MM-DD)
    if (dateSub[0].length === 4) {
      const iso = `${dateSub[0]}-${dateSub[1].padStart(2, '0')}-${dateSub[2].padStart(2, '0')}T${timePart}Z`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  return null;
}

/**
 * Duplicate detector tracking seen IDs.
 */
export class DuplicateDetector {
  private seenIds = new Set<string>();

  isDuplicate(id: string): boolean {
    const normalizedId = id.trim();
    if (this.seenIds.has(normalizedId)) {
      return true;
    }
    this.seenIds.add(normalizedId);
    return false;
  }
}
