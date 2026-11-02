import { createContext, useContext } from 'react';

export const DeviceWorkspaceContext = createContext(false);
export const useDeviceWorkspace = () => useContext(DeviceWorkspaceContext);
export const openPrivateWorkspace = () => window.dispatchEvent(new Event('worldos:open-private'));
/** Authenticate the room designer while retaining its device draft and photo. */
export const connectRoomDesigner = () => window.dispatchEvent(new CustomEvent('worldos:open-private',{detail:{room:true}}));
