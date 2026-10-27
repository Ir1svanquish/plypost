/** Keep the storage limit in UTF-16 units without leaving half a surrogate pair. */
export function unicodePrefixByCodeUnits(value: string, limit: number): string {
  let result = "";
  let units = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (units + character.length > limit) break;
    result += character;
    units += character.length;
  }
  return result;
}

export function safeImageName(value: string): string {
  const base = value.replaceAll("\\", "/").split("/").at(-1) || "image";
  const name = Array.from(base).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127 && (code < 0xd800 || code > 0xdfff);
  }).join("").trim() || "image";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(name.slice(dot)) ? name.slice(dot) : "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  return unicodePrefixByCodeUnits(stem, 120 - extension.length) + extension;
}
