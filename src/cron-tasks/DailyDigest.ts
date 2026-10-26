import { setTimeout as sleep } from 'node:timers/promises';

import { CronTask, RegisterCronTask } from '#plugins/tasks/cron/gateway';

import type { CronRunContext } from '#plugins/tasks/cron/gateway';

const SLOW_WORK_MS = 2000;

@RegisterCronTask('0 9 * * *', { timezone: 'Europe/Sarajevo' })
export class DailyDigest extends CronTask {
    public async run({ signal, trigger }: CronRunContext): Promise<void> {
        await sleep(SLOW_WORK_MS, undefined, { signal });

        const uptime = Math.floor(this.core.uptime.elapsed() / 1000);

        this.logger.info(
            `digest (${trigger}): up for ${uptime}s, next run ${this.core.cron.nextRun(this.name)?.toISOString()}`
        );
    }

    public override async onError(error: Error): Promise<void> {
        if (error.name === 'AbortError') this.logger.warn('digest cut short by shutdown');

        await Promise.resolve();
    }
}
