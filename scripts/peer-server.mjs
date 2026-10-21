// Local PeerJS signaling server for e2e tests (never the public 0.peerjs.com).
import { PeerServer } from 'peer';

const PORT = 9000;

process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`peer-server: port ${PORT} already in use`);
    process.exit(1);
  }
  throw err;
});

PeerServer({ port: PORT, path: '/' }, () => {
  console.log(`peer-server: listening on http://127.0.0.1:${PORT}/`);
});
