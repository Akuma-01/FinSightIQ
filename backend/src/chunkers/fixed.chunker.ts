export interface ChunkResult {
	text: string;
	chunkIndex: number;
	tokenCount: number;
	chunkingStrategy: string;
}

/** Naïve token estimator: ~4 chars per token (good enough for chunking decisions) */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function chunkFixed(text: string, targetTokens: 256 | 512): ChunkResult[] {
	const words = text.split(/\s+/);
	const chunks: ChunkResult[] = [];
	let current: string[] = [];
	let chunkIndex = 0;

	for (const word of words) {
		current.push(word);
		if (estimateTokens(current.join(' ')) >= targetTokens) {
			const chunkText = current.join(' ').trim();
			chunks.push({
				text: chunkText,
				chunkIndex: chunkIndex++,
				tokenCount: estimateTokens(chunkText),
				chunkingStrategy: `fixed_${targetTokens}`,
			});
			current = [];
		}
	}

	// Flush remainder
	if (current.length > 0) {
		const chunkText = current.join(' ').trim();
		if (chunkText.length > 20) { // skip very short trailing fragments
			chunks.push({
				text: chunkText,
				chunkIndex: chunkIndex++,
				tokenCount: estimateTokens(chunkText),
				chunkingStrategy: `fixed_${targetTokens}`,
			});
		}
	}

	return chunks;
}
