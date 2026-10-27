import { Subscribe, Subscriber } from '@seedcord/gateway';

@Subscribe('taskFailed')
export class TaskFailures extends Subscriber<'taskFailed'> {
    public async execute(): Promise<void> {
        const { key, trigger, durationMs, error } = this.data;

        this.logger.warn(`task ${key} (${trigger}) failed after ${durationMs}ms: ${error.message}`);

        await Promise.resolve();
    }
}
