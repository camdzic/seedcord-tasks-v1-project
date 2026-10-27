import { EventHandler, RegisterEvent } from '@seedcord/gateway';
import { Events } from 'discord.js';

import { GuildFollowUp } from '#src/tasks/GuildFollowUp';

@RegisterEvent([Events.GuildCreate])
export class GuildJoin extends EventHandler<Events.GuildCreate> {
    public async execute(): Promise<void> {
        const [guild] = this.event;

        this.core.tasks.schedule(GuildFollowUp, {
            in: '1h',
            data: { guildId: guild.id, joinedAt: new Date().toISOString() }
        });

        await Promise.resolve();
    }
}
