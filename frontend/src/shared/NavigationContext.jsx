import { createContext, useContext } from 'react';

export const NavigationContext = createContext(null);

export function useAppNavigation() {
    const navigate = useContext(NavigationContext);
    if (!navigate) throw new Error('NavigationContext is not available.');
    return navigate;
}