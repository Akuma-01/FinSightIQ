import { ChunkResult, chunkFixed } from './fixed.chunker';
import { chunkSectionAware } from './section.chunker';
import { chunkSentence } from './sentence.chunker';

export type ChunkingStrategy = 'fixed_256' | 'fixed_512' | 'sentence' | 'section_aware';

export function chunk(
	text: string,
	strategy: ChunkingStrategy,
	documentId: string
): ChunkResult[] {
	switch (strategy) {
		case 'fixed_256': return chunkFixed(text, 256);
		case 'fixed_512': return chunkFixed(text, 512);
		case 'sentence': return chunkSentence(text);
		case 'section_aware': return chunkSectionAware(text, documentId);
	}
}
