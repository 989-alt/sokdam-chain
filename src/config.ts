// Single source for network settings. Env vars (build time) override the public defaults.
const env = import.meta.env;

export const SIGNALING = {
  host: env.VITE_SIGNALING_HOST || '0.peerjs.com',
  port: Number(env.VITE_SIGNALING_PORT || 443),
  secure: (env.VITE_SIGNALING_SECURE || 'true') !== 'false',
  path: env.VITE_SIGNALING_PATH || '/',
};

// No TURN by design (PRD §10): two public STUN servers for redundancy.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const PROTOCOL_VERSION = 1;
