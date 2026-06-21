#!/usr/bin/env node

const fs = require('fs');
const WebSocket = require('../backend/node_modules/ws');

const [baseUrl, token, collectionId, outputPath] = process.argv.slice(2);

if (!baseUrl || !token || !collectionId || !outputPath) {
	console.error('Usage: phase3-ws-observer.js <base-url> <token> <collection-id> <output-path>');
	process.exit(1);
}

const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}`;
const socket = new WebSocket(wsUrl);

function write(message) {
	fs.appendFileSync(outputPath, `${JSON.stringify(message)}\n`);
}

socket.on('open', () => {
	socket.send(JSON.stringify({ action: 'join', collectionId }));
});

socket.on('message', (raw) => {
	try {
		const message = JSON.parse(raw.toString());
		write(message);
		console.log(`[ws] ${message.event}${message.seq !== undefined ? ` seq=${message.seq}` : ''}`);
	} catch (error) {
		write({ event: 'observer:error', error: error.message });
	}
});

socket.on('error', (error) => {
	write({ event: 'observer:error', error: error.message });
	console.error(`[ws] ${error.message}`);
});

function shutdown() {
	if (socket.readyState === WebSocket.OPEN) {
		socket.close(1000, 'Verification complete');
	} else {
		socket.terminate();
	}
	setTimeout(() => process.exit(0), 100);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

