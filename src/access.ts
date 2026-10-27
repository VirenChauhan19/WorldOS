import { createContext, useContext } from 'react';

export type WorkspaceAccess = 'owner' | 'judge';
export const AccessContext = createContext<WorkspaceAccess>('owner');
export const useWorkspaceAccess = () => useContext(AccessContext);
export const AuthenticationContext = createContext(false);
export const useAuthenticationRequired = () => useContext(AuthenticationContext);
