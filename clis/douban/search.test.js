import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../../extensions/opencli-bridge/registry-internal';
import './search.js';

describe('douban search command', () => {
    it('skips default pre-navigation because the adapter handles navigation itself', () => {
        const command = getRegistry().get('douban/search');
        expect(command).toBeDefined();
        expect(command?.navigateBefore).toBe(false);
    });
});
