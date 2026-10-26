import { CronTask, RegisterCronTask } from '#plugins/tasks/cron/gateway';

@RegisterCronTask('* * * * *')
export class Heartbeat extends CronTask {
    public async run(): Promise<void> {
        const { client } = this.core.bot;

        this.logger.info(`${client.ws.ping}ms gateway ping, ${client.guilds.cache.size} servers`);

        await Promise.resolve();
    }
}
