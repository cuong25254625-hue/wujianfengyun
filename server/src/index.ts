import { GameWebSocketServer } from './ws/server.js';

const port = Number(process.env.PORT ?? 8787);

const server = new GameWebSocketServer(port);
server.start();

console.log(`无间风云 MVP WebSocket server listening on ws://localhost:${port}`);
