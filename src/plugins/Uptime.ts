import { Plugin } from '@seedcord/gateway';

import type { EpochMs } from '@seedcord/gateway';

export class Uptime extends Plugin {
    public startedAt = 0 as EpochMs;

    public async init(): Promise<void> {
        this.startedAt = Date.now() as EpochMs;
        await Promise.resolve();
    }

    public elapsed(): number {
        return Date.now() - this.startedAt;
    }
}
