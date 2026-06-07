export interface PresenceEntry {
	userId: string;
	displayName: string;
	role: string;
}

// collectionId → userId → PresenceEntry
const rooms = new Map<string, Map<string, PresenceEntry>>();

export function add(collectionId: string, entry: PresenceEntry): void {
	if (!rooms.has(collectionId)) rooms.set(collectionId, new Map());
	rooms.get(collectionId)!.set(entry.userId, entry);
}

export function remove(collectionId: string, userId: string): void {
	rooms.get(collectionId)?.delete(userId);
	if (rooms.get(collectionId)?.size === 0) rooms.delete(collectionId);
}

export function get(collectionId: string): PresenceEntry[] {
	return Array.from(rooms.get(collectionId)?.values() ?? []);
}

export function removeFromAll(userId: string): string[] {
	const affected: string[] = [];
	for (const [collectionId, members] of rooms) {
		if (members.has(userId)) {
			members.delete(userId);
			affected.push(collectionId);
			if (members.size === 0) rooms.delete(collectionId);
		}
	}
	return affected;
}
