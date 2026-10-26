import { ActivityType } from 'discord.js';

import { CronTask, RegisterCronTask } from '#plugins/tasks/cron/gateway';

const activities = ['the clock', 'cron patterns', 'seconds tick by'];

@RegisterCronTask('*/30 * * * * *', { name: 'presence' })
export class RotatePresence extends CronTask {
    private index = 0;

    public async run(): Promise<void> {
        const name = activities[this.index++ % activities.length] ?? 'the clock';

        this.core.bot.client.user?.setActivity(name, { type: ActivityType.Watching });

        await Promise.resolve();
    }
}
