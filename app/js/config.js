// Firebase web config. This is not a secret: it ships to every browser that
// opens the app. Replace it with your project's config (README, one-time setup).
export const firebaseConfig = {
  apiKey: 'AIzaSyCj0RRD02ywJcJ26A5CRdDATuCAxFp7bJw',
  authDomain: 'bebetrack-f7nn.firebaseapp.com',
  projectId: 'bebetrack-f7nn',
  storageBucket: 'bebetrack-f7nn.firebasestorage.app',
  messagingSenderId: '648000872855',
  appId: '1:648000872855:web:67a87bb2c68d6c6a15e4d2',
};

// Running on this computer: always talk to the local Firestore emulator.
export const LOCAL_CONFIG = { projectId: 'demo-bebetrack', apiKey: 'demo', appId: 'demo' };
export const EMULATOR = { host: '127.0.0.1', port: 8080 };

export const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const isConfigured = isLocal || firebaseConfig.projectId !== 'demo-bebetrack';
