import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * ARGOLET mobile — build configuration for the App Store and Google Play.
 *
 *  APP_ENV=production (EAS "production" profile): the app only talks to the ARGOLET server given
 *  by EXPO_PUBLIC_API_URL (https). It never falls back to sample data. The build stops here when
 *  that URL is missing, so a store build cannot ship without its server.
 *  APP_ENV=preview / development: internal builds; without a reachable server they run the full
 *  application on the device with clearly-labelled sample data, for demos and testing.
 */
const APP_ENV = (process.env.APP_ENV ?? 'development') as 'production' | 'preview' | 'development';
const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();

if (APP_ENV === 'production' && !/^https:\/\/[^\s/]+/.test(API_URL))
  throw new Error(
    'Bản phát hành cần EXPO_PUBLIC_API_URL dạng https://… — đặt bằng: eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<máy chủ ARGOLET>',
  );

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ARGOLET',
  slug: 'argolet',
  scheme: 'argolet',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7F8',
  splash: { image: './assets/splash.png', resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  ios: {
    bundleIdentifier: 'vn.argolet.app',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'ARGOLET dùng camera để chụp chứng từ và đọc mã QR hóa đơn.',
      NSPhotoLibraryUsageDescription: 'ARGOLET cần truy cập ảnh để tải chứng từ.',
      // Only standard HTTPS / OS cryptography: no export-compliance documents needed.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'vn.argolet.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FFFFFF' },
    permissions: ['android.permission.CAMERA'],
    // The camera module would otherwise request the microphone; ARGOLET never records audio.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    // Session tokens and server settings stay on the device: no cloud backup of app data.
    allowBackup: false,
  },
  web: { bundler: 'metro', favicon: './assets/icon.png' },
  plugins: [
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: 'ARGOLET cần truy cập ảnh để tải chứng từ.',
        cameraPermission: 'ARGOLET dùng camera để chụp chứng từ và đọc mã QR hóa đơn.',
        microphonePermission: false,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'ARGOLET dùng camera để chụp chứng từ và đọc mã QR hóa đơn.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
  ],
  // An empty string, not null, when unset: the web manifest turns null into {}.
  extra: { apiUrl: API_URL, appEnv: APP_ENV },
});
