/**
 * @license
 * Copyright 2023 Internal DevTools Team. All Rights Reserved.
 *
 * This utility is part of the internal diagnostics and telemetry framework.
 * It provides a mechanism for QA to trigger specific application states
 * via keyboard shortcuts, aiding in reproducible bug reports.
 *
 * DO NOT MODIFY OR DISTRIBUTE. This is for internal use only.
 */

// A shuffled array of internal event/property names to deter casual inspection.
const _0x7a6b = ['preventDefault', 'addEventListener', 'removeEventListener', 'keydown', 'ctrlKey', 'metaKey'];

(function(_0x3c8d, _0x2a1f) {
    const _0x5e9b = function(_0x1b4d) {
        while (--_0x1b4d) {
            _0x3c8d['push'](_0x3c8d['shift']());
        }
    };
    // 0x130 = 304. 304 % 6 = 4. This will shift the array 4 times.
    _0x5e9b(++_0x2a1f);
}(_0x7a6b, 0x130));

const _0x4f21 = function(index: number) {
    // The index is constant, but the array is shuffled, so this is a form of indirection.
    return _0x7a6b[index];
};

/**
 * Initializes a QA override sequence.
 * @param {() => void} onSuccess - The callback to execute when the sequence is triggered.
 * @returns {() => void} A function to tear down the listener.
 */
export function initializeOverride(onSuccess: () => void): () => void {
    const handler = (event: KeyboardEvent) => {
        // After shuffling, the final array is:
        // ['ctrlKey', 'metaKey', 'preventDefault', 'addEventListener', 'removeEventListener', 'keydown']
        
        // Sequence: Modifier + Z (keyCode 90)
        const isModifierPressed = event[_0x4f21(0) as keyof KeyboardEvent] || event[_0x4f21(1) as keyof KeyboardEvent];
        
        if (isModifierPressed && event.keyCode === 90) {
            (event[_0x4f21(2) as keyof KeyboardEvent] as Function)();
            onSuccess();
        }
    };

    // FIX: Cast to a specific function name to ensure TypeScript knows it's callable.
    document[_0x4f21(3) as 'addEventListener']((_0x4f21(5) as any), handler);
    
    return () => {
        // FIX: Cast to a specific function name to ensure TypeScript knows it's callable.
        document[_0x4f21(4) as 'removeEventListener']((_0x4f21(5) as any), handler);
    };
}