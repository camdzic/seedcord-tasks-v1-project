# seedcord-tasks-v1-project

A Discord bot built with [seedcord](https://seedcord.org) on the gateway transport.

## Running it

```sh
bun run dev
```

That starts the dev server with hot reload.

## Scripts

<!-- prettier-ignore-start -->

| script | what it does |
| --- | --- |
| `bun run dev` | dev server with hot reload |
| `bun run build` | compile to `dist/` |
| `bun run start` | run the compiled build |
| `bun run codegen` | regenerate `src/seedcord-gen.d.ts` |
| `bun run commands` | list, deploy, or clean up your commands on Discord |
| `bun run commands:deploy` | send your commands to Discord |
| `bun run tc` | type-check |
| `bun run lint` | eslint |
| `bun run check` | type-check, lint, and check formatting |

<!-- prettier-ignore-end -->

Run `codegen` after you add a command or change its options. It writes the types behind `this.options`, and the generated file is committed.

## Environment

`.env` holds your secrets and is gitignored.

<!-- prettier-ignore-start -->

| key | required |
| --- | --- |
| `DISCORD_BOT_TOKEN` | yes |
| `UNKNOWN_EXCEPTION_WEBHOOK_URL` | no |
| `HANDLED_EXCEPTION_WEBHOOK_URL` | no |
| `TESTING_GUILD_IDS` | no, empty deploys your commands globally |
| `ENV` | no, defaults to `development` |

<!-- prettier-ignore-end -->

The two webhook keys take Discord webhook URLs. Set them to get error reports posted to a channel.

## Where things go

- `src/commands/` holds command definitions, one class per command.
- `src/handlers/` holds the code that runs when someone uses one.
- `src/events/` holds event handlers for the things happening in a server.
- `src/tasks/` holds tasks that run on a cron pattern or when scheduled, one class per task.
- `src/bot.ts` is the config.

## Docs

- Guide: <https://seedcord.org/guide>
- API reference: <https://seedcord.org/docs>
