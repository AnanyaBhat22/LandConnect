import { registerGlobals } from '@livekit/react-native';

// Installs the native WebRTC implementation as JS globals (RTCPeerConnection etc.).
// This module is imported first in index.ts, so it runs before any LiveKit code.
registerGlobals();
