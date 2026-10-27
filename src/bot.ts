import { Seedcord } from '@seedcord/gateway';
import { GatewayIntentBits } from 'discord.js';
import { Converters, Envapter } from 'envapt';

import { Tasks } from '#plugins/tasks';
import { Uptime } from '#plugins/Uptime';

export const seedcord = new Seedcord({
    bot: {
        clientOptions: {
            intents: [GatewayIntentBits.Guilds]
        },
        interactions: {
            path: './handlers'
        },
        commands: {
            path: './commands',
            guilds: Envapter.getAs('TESTING_GUILD_IDS', Converters.array(), [])
        },
        events: {
            path: './events'
        }
    },
    subscribers: {
        path: './subscribers'
    },
    botColor: 'Blurple',
    notifications: {
        developerUsername: 'Aldin Čamdžić'
    }
})
    .attach('uptime', Uptime)
    .attach('tasks', Tasks, { path: './tasks', timezone: 'UTC' });

export default seedcord;
