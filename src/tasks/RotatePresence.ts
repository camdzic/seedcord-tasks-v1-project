import { ActivityType } from 'discord.js';

import { RegisterTask, Task } from '#plugins/tasks/gateway';

const activities = ['the clock', 'cron patterns', 'seconds tick by'];
const INTERVAL_MS = 30_000;

@RegisterTask('*/30 * * * * *', { key: 'presence' })
export class RotatePresence extends Task {
    public async execute(): Promise<void> {
        const name = activities[Math.floor(this.startedAt.getTime() / INTERVAL_MS) % activities.length] ?? 'the clock';

        this.core.bot.client.user?.setActivity(name, { type: ActivityType.Watching });

        await Promise.resolve();
    }
}
