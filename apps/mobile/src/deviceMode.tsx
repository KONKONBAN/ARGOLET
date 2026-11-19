import { createContext, useContext } from 'react';
import type { DeviceMode } from './backend';

/**
 * Which data the app runs on when it works on the phone itself: the organisation's own (kept on
 * the device) or the sample company someone opened to try the app. Switching restarts the app's
 * connection; on a company server this does not apply.
 */
export const DeviceModeContext = createContext<{
  mode: DeviceMode;
  switchTo: (mode: DeviceMode) => void;
}>({ mode: 'own', switchTo: () => undefined });

export const useDeviceMode = () => useContext(DeviceModeContext);
