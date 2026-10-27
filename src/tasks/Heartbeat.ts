import { RegisterTask, Task } from '#plugins/tasks/gateway';

@RegisterTask('* * * * *')
export class Heartbeat extends Task {
    public async execute(): Promise<void> {
        const { client } = this.core.bot;

        this.logger.info(`${client.ws.ping}ms gateway ping, ${client.guilds.cache.size} servers`);

        await Promise.resolve();
    }
}
