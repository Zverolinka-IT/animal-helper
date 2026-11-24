const normalize = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Optimal string alignment against any substring. Starting each column at zero
// allows partial matches; the extra previous row counts swapped letters as one
// edit. Punctuation is ordinary text, never a wildcard or a regular expression.
const hasFuzzySubstring = (
  text: string,
  term: string,
  maxEdits: number,
): boolean => {
  let beforePrevious: number[] = [];
  let previous: number[] = Array.from({ length: text.length + 1 }, () => 0);
  for (let i = 1; i <= term.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= text.length; j++) {
      let distance = Math.min(
        (previous[j] ?? i) + 1,
        (current[j - 1] ?? i) + 1,
        (previous[j - 1] ?? i) + (term[i - 1] === text[j - 1] ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        term[i - 1] === text[j - 2] &&
        term[i - 2] === text[j - 1]
      ) {
        distance = Math.min(distance, (beforePrevious[j - 2] ?? i) + 1);
      }
      current[j] = distance;
      if (i === term.length && distance <= maxEdits) return true;
    }
    beforePrevious = previous;
    previous = current;
  }
  return false;
};

/**
 * All whitespace-separated terms must match, in any order or field. Matching
 * ignores case and accents and accepts literal substrings. Terms with at least
 * four letters/digits tolerate one insertion, deletion, replacement or swap;
 * terms with at least eight tolerate two. Short terms remain literal to avoid
 * unrelated results. Compile once per search, then reuse across records.
 */
export const createSearchMatcher = (
  query: string,
): ((fields: readonly (string | undefined)[]) => boolean) => {
  const terms = normalize(query)
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => {
      const length = term.replace(/[^\p{L}\p{N}]/gu, "").length;
      return { term, maxEdits: length < 4 ? 0 : length < 8 ? 1 : 2 };
    });
  return (fields) => {
    if (terms.length === 0) return true;
    const texts = fields
      .filter((field): field is string => typeof field === "string")
      .map(normalize)
      .filter(Boolean);
    return terms.every(({ term, maxEdits }) =>
      texts.some(
        (text) =>
          text.includes(term) ||
          (maxEdits > 0 && hasFuzzySubstring(text, term, maxEdits)),
      ),
    );
  };
};
