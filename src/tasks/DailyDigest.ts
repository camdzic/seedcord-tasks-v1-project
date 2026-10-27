import { setTimeout as sleep } from 'node:timers/promises';

import { RegisterTask, Task } from '#plugins/tasks/gateway';

const SLOW_WORK_MS = 2000;

@RegisterTask('0 9 * * *', { timezone: 'Europe/Sarajevo' })
export class DailyDigest extends Task {
    public async execute(): Promise<void> {
        await sleep(SLOW_WORK_MS, undefined, { signal: this.signal });

        const uptime = Math.floor(this.core.uptime.elapsed() / 1000);
        const next = this.core.tasks.nextRun(DailyDigest);

        this.logger.info(`digest (${this.trigger}): up for ${uptime}s, next run ${next ? next.toISOString() : 'none'}`);
    }

    public override async onError(error: Error): Promise<void> {
        if (error.name === 'AbortError') this.logger.warn('digest cut short by shutdown');

        await Promise.resolve();
    }
}
