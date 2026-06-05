import { ChunkResult } from './fixed.chunker';

const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 50;

function estimateTokens(t: string) { return Math.ceil(t.length / 4); }

/** Split on sentence-ending punctuation, keeping delimiter with sentence */
function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

export function chunkSentence(text: string): ChunkResult[] {
	const sentences = splitSentences(text);
	const chunks: ChunkResult[] = [];
	let buffer: string[] = [];
	let chunkIndex = 0;

	const flush = () => {
		if (!buffer.length) return;
		const chunkText = buffer.join(' ').trim();
		chunks.push({
			text: chunkText,
			chunkIndex: chunkIndex++,
			tokenCount: estimateTokens(chunkText),
			chunkingStrategy: 'sentence',
		});
	};

	for (const sentence of sentences) {
		buffer.push(sentence);

		if (estimateTokens(buffer.join(' ')) >= TARGET_TOKENS) {
			flush();

			// Overlap: carry last ~OVERLAP_TOKENS worth of sentences into next chunk
			const overlap: string[] = [];
			let overlapTokens = 0;
			for (let i = buffer.length - 1; i >= 0; i--) {
				const t = estimateTokens(buffer[i]);
				if (overlapTokens + t > OVERLAP_TOKENS) break;
				overlap.unshift(buffer[i]);
				overlapTokens += t;
			}
			buffer = overlap;
		}
	}

	flush(); // final partial chunk
	return chunks;
}
