import { logger } from '../lib/logger';
import { ChunkResult, chunkFixed } from './fixed.chunker';
import { chunkSentence } from './sentence.chunker';

const MAX_SECTION_TOKENS = 600;

const SECTION_HEADER_RE = /^(?:(?:section|article|clause|chapter|part)\s+[\d.IVXLC]+|[\d]{1,2}(?:\.[\d]{1,3}){0,3}\s+[A-Z])/im;

function estimateTokens(t: string) { return Math.ceil(t.length / 4); }

function detectSections(text: string): Array<{ header: string; body: string }> {
	const lines = text.split('\n');
	const sections: Array<{ header: string; body: string }> = [];
	let currentHeader = 'Preamble';
	let currentBody: string[] = [];

	for (const line of lines) {
		if (SECTION_HEADER_RE.test(line.trim())) {
			if (currentBody.join('\n').trim().length > 0) {
				sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
			}
			currentHeader = line.trim();
			currentBody = [];
		} else {
			currentBody.push(line);
		}
	}

	if (currentBody.join('\n').trim().length > 0) {
		sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
	}

	return sections;
}

export function chunkSectionAware(text: string, documentId: string): ChunkResult[] {
	const sections = detectSections(text);

	if (sections.length < 3) {
		logger.warn({ documentId, sectionsFound: sections.length },
			'section_aware fallback → sentence (fewer than 3 sections detected)');
		return chunkSentence(text).map(c => ({ ...c, chunkingStrategy: 'sentence' }));
	}

	const chunks: ChunkResult[] = [];
	let chunkIndex = 0;

	for (const section of sections) {
		const sectionText = `${section.header}\n${section.body}`;
		const tokens = estimateTokens(sectionText);

		if (tokens <= MAX_SECTION_TOKENS) {
			// Section fits in one chunk
			chunks.push({
				text: sectionText,
				chunkIndex: chunkIndex++,
				tokenCount: tokens,
				chunkingStrategy: 'section_aware',
			});
		} else {

			const subChunks = chunkSentence(section.body);
			for (const sub of subChunks) {
				chunks.push({
					text: `${section.header}\n${sub.text}`,
					chunkIndex: chunkIndex++,
					tokenCount: sub.tokenCount,
					chunkingStrategy: 'section_aware',
				});
			}
		}
	}

	return chunks;
}
