import { globSync } from 'glob';
import * as path from 'path';

export function loadLocalRegistry(clisDir: string): any[] {
    (global as any)._registeredSchemas = [];
    
    // We would need a module loader hook or similar to intercept the imports
    // or rewrite the files on-the-fly.
    // Given the task, let's proceed with an alternative: 
    // we can use the existing 'opencli' executable, but install it locally in the project.
    
    return [];
}
