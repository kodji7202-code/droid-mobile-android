/**
 * Cuts `text` to the longest prefix whose UTF-8 encoding fits in `maxBytes`,
 * never splitting a code point (including surrogate pairs).
 */
export function truncateToUtf8Bytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  // A UTF-16 unit encodes to at most 3 UTF-8 bytes, so short strings always fit.
  if (text.length * 3 <= maxBytes) {
    return { text, truncated: false };
  }

  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const unit = text.charCodeAt(index);
    let size: number;
    let units = 1;
    if (unit < 0x80) {
      size = 1;
    } else if (unit < 0x800) {
      size = 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && isLowSurrogate(text, index + 1)) {
      size = 4;
      units = 2;
    } else {
      size = 3;
    }
    if (bytes + size > maxBytes) {
      return { text: text.slice(0, index), truncated: true };
    }
    bytes += size;
    index += units;
  }
  return { text, truncated: false };
}

function isLowSurrogate(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
}
