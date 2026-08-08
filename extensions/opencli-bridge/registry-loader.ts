import { globSync } from 'glob';
import * as path from 'path';
import * as fs from 'fs';

// Mock the opencli registry registration
(global as any)._registeredSchemas = [];

export function loadLocalRegistry(clisDir: string) {
    const files = globSync(path.join(clisDir, '**/*.js'));
    const registryMockPath = path.resolve(__dirname, './registry-mock.ts');
    
    // Simple loader that mocks the registration
    for (const file of files) {
        // Need to handle the imports in the files. Since they import @jackwener/opencli/registry,
        // we would need to map that import to our mock.
        // For now, this is a conceptual placeholder.
    }
    
    return (global as any)._registeredSchemas;
}
