import { RegisterTask, Task } from '#plugins/tasks/gateway';

@RegisterTask()
export class GuildFollowUp extends Task<{ guildId: string; joinedAt: string }> {
    public async execute(): Promise<void> {
        const { guildId, joinedAt } = this.data;

        const guild = this.core.bot.client.guilds.cache.get(guildId);

        if (!guild) {
            this.logger.info(`left ${guildId} within the hour after joining at ${joinedAt}`);
            return;
        }

        this.logger.info(`still in ${guild.name} an hour after joining, ${guild.memberCount} members`);

        await Promise.resolve();
    }
}
