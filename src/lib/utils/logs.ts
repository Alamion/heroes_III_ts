export const DEBUG_MODE = import.meta.env.DEV;

export function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log('[DEBUG]', ...args);
    }
}

export function debugWarn(...args: any[]): void {
    if (DEBUG_MODE) {
        console.warn('[DEBUG WARNING]', ...args);
    }
}

export function debugError(...args: any[]): void {
    if (DEBUG_MODE) {
        console.error('[DEBUG ERROR]', ...args);
    }
}
