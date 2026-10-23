import { decodeAndIndex, searchParagraphs, type TextIndex } from './readerText';

let textIndex: TextIndex | undefined;
self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'parse') {
      textIndex = decodeAndIndex(message.buffer, message.encoding);
      self.postMessage({ type: 'parsed', id: message.id, ...textIndex });
    } else if (message.type === 'search') {
      self.postMessage({ type: 'matches', id: message.id, ...searchParagraphs(textIndex?.paragraphs || [], message.query) });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, error: error instanceof Error ? error.message : '无法读取这本书。' });
  }
};
