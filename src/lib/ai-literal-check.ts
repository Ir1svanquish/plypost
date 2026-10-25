export type LiteralChanges = { missing: string[]; added: string[] };

type Literal = { key: string; label: string };

const weekdays: Record<string, string> = {
  mon: "monday", monday: "monday", tue: "tuesday", tues: "tuesday", tuesday: "tuesday",
  wed: "wednesday", wednesday: "wednesday", thu: "thursday", thur: "thursday",
  thurs: "thursday", thursday: "thursday", fri: "friday", friday: "friday",
  sat: "saturday", saturday: "saturday", sun: "sunday", sunday: "sunday",
};

function literals(text: string): Literal[] {
  const found = new Map<string, string>();
  const add = (kind: string, label: string, normalized = label) => {
    const key = `${kind}:${normalized}`;
    if (!found.has(key)) found.set(key, label);
  };

  let rest = text.replace(/(?:https?:\/\/|www\.)[^\s<>"'`]+/giu, (raw) => {
    const link = raw.replace(/[.,;!?)\]}]+$/u, "");
    if (link) add("url", link);
    return " ";
  });
  rest = rest.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, (email) => {
    add("email", email, email.toLocaleLowerCase());
    return " ";
  });
  rest = rest.replace(/(^|[^\p{L}\p{N}_])([@#][\p{L}\p{N}_.-]+)/gu, (_match, prefix: string, raw: string) => {
    const tag = raw.replace(/[.-]+$/u, "");
    if (tag.length > 1) add("tag", tag, tag.toLocaleLowerCase());
    return `${prefix} `;
  });
  for (const match of rest.matchAll(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thurs?|fri|sat|sun)\b/giu)) {
    add("weekday", match[0], weekdays[match[0].toLocaleLowerCase()]);
  }
  for (const match of rest.matchAll(/(?:星期|周|礼拜)[一二三四五六日天]/gu)) {
    add("weekday", match[0], match[0].at(-1) === "天" ? "日" : match[0].at(-1));
  }
  for (const match of rest.matchAll(/(?:^|[^a-z])([ap]\.?m\.?)(?![a-z])/giu)) {
    add("time", match[1], match[1].toLocaleLowerCase().startsWith("a") ? "am" : "pm");
  }
  for (const match of rest.matchAll(/上午|下午|早上|晚上|中午|凌晨/gu)) {
    const period = match[0] === "上午" || match[0] === "早上" ? "am"
      : match[0] === "下午" ? "pm" : match[0];
    add("time", match[0], period);
  }
  for (const match of rest.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)) {
    const number = match[0];
    add("number", number, number.replace(/,(?=\d{3}(?:$|[.,]))/g, "").replace(/^0+(?=\d)/, ""));
  }
  return [...found].map(([key, label]) => ({ key, label }));
}

/** A limited local check of exact details, not a claim that the suggestion is factually correct. */
export function compareAiLiterals(source: string, suggestion: string): LiteralChanges {
  const before = literals(source);
  const after = literals(suggestion);
  const beforeKeys = new Set(before.map((item) => item.key));
  const afterKeys = new Set(after.map((item) => item.key));
  return {
    missing: before.filter((item) => !afterKeys.has(item.key)).map((item) => item.label),
    added: after.filter((item) => !beforeKeys.has(item.key)).map((item) => item.label),
  };
}
