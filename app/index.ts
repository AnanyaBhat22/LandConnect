import { registerRootComponent } from 'expo';
import { registerGlobals } from '@livekit/react-native';

import App from './App';

// Installs the native WebRTC implementation as JS globals (RTCPeerConnection etc.).
// It must run before any LiveKit code, which is why it lives in the entry file.
registerGlobals();

registerRootComponent(App);
