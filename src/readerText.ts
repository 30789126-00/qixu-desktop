export interface TextParagraph { text: string; heading: boolean }
export interface TextChapter { label: string; index: number }
export interface TextIndex { paragraphs: TextParagraph[]; chapters: TextChapter[]; encoding: string; characters: number }
export interface TextMatch { label: string; position: string; index: number }

const headingPattern = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章回卷部节集篇]|chapter\s+[\divxlc]+\b|(?:序章|序言|前言|引子|楔子|尾声|后记|终章|番外)(?:\s|$|[：:]))/i;

/** Decode and index off the UI thread; cap a visual paragraph so a single long line stays cheap. */
export function decodeAndIndex(buffer: ArrayBuffer, requested?: string): TextIndex {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new Error('这本书是空文件，请重新选择。');
  let encoding = requested && requested !== 'auto' ? requested : '';
  if (!encoding) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    else {
      const sampleLength = Math.min(bytes.length, 4096);
      let evenNulls = 0, oddNulls = 0;
      for (let i = 0; i < sampleLength; i++) if (bytes[i] === 0) i % 2 ? oddNulls++ : evenNulls++;
      if (oddNulls > sampleLength * .2 && evenNulls < sampleLength * .02) encoding = 'utf-16le';
      else if (evenNulls > sampleLength * .2 && oddNulls < sampleLength * .02) encoding = 'utf-16be';
      else {
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
        catch { encoding = 'gb18030'; }
      }
    }
  }
  const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.slice(0, 2000).includes('\u0000') && !encoding.startsWith('utf-16')) throw new Error('无法识别文本内容，请尝试切换为 UTF-16 编码。');
  const paragraphs: TextParagraph[] = [];
  const chapters: TextChapter[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.length < 100 && headingPattern.test(line);
    if (heading) chapters.push({ label: line, index: paragraphs.length });
    for (let start = 0; start < line.length;) {
      let end = Math.min(start + 1200, line.length);
      // Do not split the UTF-16 pair of an emoji at a chunk boundary.
      if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1])) end--;
      paragraphs.push({ text: line.slice(start, end), heading: heading && start === 0 });
      start = end;
    }
  }
  if (!paragraphs.length) throw new Error('这本书没有可阅读的文字。');
  if (!chapters.length) chapters.push({ label: '正文', index: 0 });
  else if (chapters[0].index !== 0) chapters.unshift({ label: '开篇', index: 0 });
  return { paragraphs, chapters, encoding, characters: text.length };
}

export function searchParagraphs(paragraphs: TextParagraph[], query: string): { matches: TextMatch[]; count: number } {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { matches: [], count: 0 };
  const matches: TextMatch[] = [];
  let count = 0;
  for (let index = 0; index < paragraphs.length; index++) {
    const source = paragraphs[index].text;
    const found = source.toLocaleLowerCase().indexOf(needle);
    if (found < 0) continue;
    count++;
    if (matches.length < 200) matches.push({ label: `${found > 20 ? '…' : ''}${source.slice(Math.max(0, found - 20), found + needle.length + 60)}`, position: `txt:${index}:0`, index });
  }
  return { matches, count };
}
