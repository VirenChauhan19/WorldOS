import { createContext, useContext } from 'react';

export const DeviceWorkspaceContext = createContext(false);
export const useDeviceWorkspace = () => useContext(DeviceWorkspaceContext);
export const openPrivateWorkspace = () => window.dispatchEvent(new Event('worldos:open-private'));
