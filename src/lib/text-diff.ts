export type TextPart = { text: string; changed: boolean };

function append(parts: TextPart[], text: string, changed: boolean) {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.changed === changed) last.text += text;
  else parts.push({ text, changed });
}

function edgeDiff(before: string, after: string): { before: TextPart[]; after: TextPart[] } {
  const oldChars = Array.from(before);
  const newChars = Array.from(after);
  let start = 0;
  while (start < oldChars.length && start < newChars.length && oldChars[start] === newChars[start]) start++;
  let end = 0;
  while (end < oldChars.length - start && end < newChars.length - start &&
    oldChars[oldChars.length - 1 - end] === newChars[newChars.length - 1 - end]) end++;
  const beforeParts: TextPart[] = [];
  const afterParts: TextPart[] = [];
  const prefix = oldChars.slice(0, start).join("");
  const suffix = end ? oldChars.slice(-end).join("") : "";
  for (const parts of [beforeParts, afterParts]) append(parts, prefix, false);
  append(beforeParts, oldChars.slice(start, oldChars.length - end).join(""), true);
  append(afterParts, newChars.slice(start, newChars.length - end).join(""), true);
  for (const parts of [beforeParts, afterParts]) append(parts, suffix, false);
  return { before: beforeParts, after: afterParts };
}

export function compareText(before: string, after: string): { changed: boolean; before: TextPart[]; after: TextPart[] } {
  if (before === after) return { changed: false, before: [{ text: before, changed: false }], after: [{ text: after, changed: false }] };

  // Keep the comparison responsive even for unusually long model output.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const oldWords = Array.from(segmenter.segment(before), (part) => part.segment);
  const newWords = Array.from(segmenter.segment(after), (part) => part.segment);
  const maxWords = 400;
  if (oldWords.length > maxWords || newWords.length > maxWords) return { changed: true, ...edgeDiff(before, after) };

  const width = newWords.length + 1;
  const shared = new Uint16Array((oldWords.length + 1) * width);
  for (let i = oldWords.length - 1; i >= 0; i--) {
    for (let j = newWords.length - 1; j >= 0; j--) {
      shared[i * width + j] = oldWords[i] === newWords[j]
        ? 1 + shared[(i + 1) * width + j + 1]
        : Math.max(shared[(i + 1) * width + j], shared[i * width + j + 1]);
    }
  }

  const oldParts: TextPart[] = [];
  const newParts: TextPart[] = [];
  let i = 0;
  let j = 0;
  while (i < oldWords.length || j < newWords.length) {
    if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
      append(oldParts, oldWords[i], false);
      append(newParts, newWords[j], false);
      i++;
      j++;
    } else if (i < oldWords.length && (j === newWords.length || shared[(i + 1) * width + j] >= shared[i * width + j + 1])) {
      append(oldParts, oldWords[i++], true);
    } else {
      append(newParts, newWords[j++], true);
    }
  }
  return { changed: true, before: oldParts, after: newParts };
}
