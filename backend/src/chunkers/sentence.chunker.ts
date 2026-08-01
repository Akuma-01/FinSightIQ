import { ChunkResult } from './fixed.chunker';

const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 50;

function estimateTokens(t: string) { return Math.ceil(t.length / 4); }

/**
 * SEC filings often contain tables or inline-XBRL runs with no sentence-ending
 * punctuation. Never pass one of those runs as a single embedding prompt.
 */
function splitOversizedSentence(sentence: string): string[] {
	if (estimateTokens(sentence) <= TARGET_TOKENS) return [sentence];

	const maxChars = TARGET_TOKENS * 4;
	const fragments: string[] = [];
	let buffer = '';

	const flush = () => {
		if (buffer.trim()) fragments.push(buffer.trim());
		buffer = '';
	};

	for (const word of sentence.split(/\s+/)) {
		if (!word) continue;
		if (word.length > maxChars) {
			flush();
			for (let start = 0; start < word.length; start += maxChars) {
				fragments.push(word.slice(start, start + maxChars));
			}
			continue;
		}

		const next = buffer ? `${buffer} ${word}` : word;
		if (next.length > maxChars) {
			flush();
			buffer = word;
		} else {
			buffer = next;
		}
	}
	flush();
	return fragments;
}

function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

export function chunkSentence(text: string): ChunkResult[] {
	const sentences = splitSentences(text).flatMap(splitOversizedSentence);
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

	const takeOverlap = (sentences: string[]) => {
		const overlap: string[] = [];
		let overlapTokens = 0;
		for (let i = sentences.length - 1; i >= 0; i--) {
			const tokens = estimateTokens(sentences[i]);
			if (overlapTokens + tokens > OVERLAP_TOKENS) break;
			overlap.unshift(sentences[i]);
			overlapTokens += tokens;
		}
		return overlap;
	};

	for (const sentence of sentences) {
		const candidate = [...buffer, sentence].join(' ');
		if (buffer.length && estimateTokens(candidate) > TARGET_TOKENS) {
			const completed = buffer;
			flush();
			const overlap = takeOverlap(completed);
			buffer = estimateTokens([...overlap, sentence].join(' ')) <= TARGET_TOKENS ? overlap : [];
		}

		buffer.push(sentence);

		if (estimateTokens(buffer.join(' ')) >= TARGET_TOKENS) {
			const completed = buffer;
			flush();
			buffer = takeOverlap(completed);
		}
	}

	flush(); // final partial chunk
	return chunks;
}
