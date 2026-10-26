import { Subscribe, Subscriber } from '@seedcord/gateway';

@Subscribe('cronTaskFailed')
export class CronFailures extends Subscriber<'cronTaskFailed'> {
    public async execute(): Promise<void> {
        const { name, trigger, durationMs, error } = this.data;

        this.logger.warn(`cron task ${name} (${trigger}) failed after ${durationMs}ms: ${error.message}`);
        await Promise.resolve();
    }
}
