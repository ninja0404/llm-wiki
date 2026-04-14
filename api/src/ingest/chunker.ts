import { CHUNK_SIZE, CHUNK_OVERLAP } from '@llm-wiki/shared';

export interface Chunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

export function splitIntoChunks(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): Chunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let current = '';
  let idx = 0;

  for (const para of paragraphs) {
    const combined = current ? `${current}\n\n${para}` : para;
    const tokenEst = estimateTokens(combined);

    if (tokenEst > chunkSize && current) {
      chunks.push({
        index: idx++,
        content: current.trim(),
        tokenEstimate: estimateTokens(current),
      });

      const overlapText = getOverlapText(current, overlap);
      current = overlapText ? `${overlapText}\n\n${para}` : para;
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push({
      index: idx,
      content: current.trim(),
      tokenEstimate: estimateTokens(current),
    });
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getOverlapText(text: string, overlapTokens: number): string {
  const targetChars = overlapTokens * 4;
  if (text.length <= targetChars) return text;

  const tail = text.slice(-targetChars);
  const sentenceStart = tail.indexOf('. ');
  if (sentenceStart >= 0 && sentenceStart < targetChars / 2) {
    return tail.slice(sentenceStart + 2);
  }
  return tail;
}
