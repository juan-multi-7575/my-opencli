import { cli } from '../../../extensions/opencli-bridge/registry-internal';
import { createRankingCliOptions } from './rankings.js';
cli(createRankingCliOptions({
    commandName: 'movers-shakers',
    access: 'read',
    listType: 'movers_shakers',
    description: 'Amazon Movers & Shakers pages for short-term growth signals',
}));
