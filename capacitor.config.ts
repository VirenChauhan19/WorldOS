import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.worldos.inspect',
  appName: 'WorldOS',
  webDir: 'dist',
  server: { androidScheme: 'https', iosScheme: 'capacitor', cleartext: false },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic' },
};
export default config;
