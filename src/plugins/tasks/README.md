# tasks plugin (draft)

A draft of a seedcord plugin for code that runs on its own, without a command. One `Task` class covers both kinds:

| kind      | how it runs                                         | state                            |
| --------- | --------------------------------------------------- | -------------------------------- |
| cron      | by itself, on a pattern in `@RegisterTask(pattern)` | done, through croner             |
| scheduled | once, when code calls `tasks.schedule(Task, ...)`   | in memory until official `Store` |

In this bot `#plugins/tasks` stands in for `@seedcord/plugin-tasks`.

## Setup

```ts title="src/bot.ts"
import { Tasks } from '#plugins/tasks';

export default seedcord.attach('tasks', Tasks, { path: './tasks', timezone: 'UTC' });
```

Both kinds live in `path`, one class per task. The plugin loads them with `importFiles`, so they're part of the build.

## A cron task

```ts title="src/tasks/Heartbeat.ts"
import { RegisterTask, Task } from '#plugins/tasks/gateway';

@RegisterTask('* * * * *')
export class Heartbeat extends Task {
    public async execute(): Promise<void> {
        this.logger.info(`${this.core.bot.client.guilds.cache.size} servers`);
    }
}
```

With a pattern, `@RegisterTask(pattern, options?)` also takes `key`, `timezone`, `protect` (on by default), `paused`, `maxRuns`, `startAt` and `stopAt`. A cron task can't declare data, since nothing passes it any. Writing `@RegisterTask('...')` on a `Task<{ ... }>` fails to compile.

## A scheduled task

```ts title="src/tasks/Unban.ts"
@RegisterTask()
export class Unban extends Task<{ guildId: string; userId: string }> {
    public async execute(): Promise<void> {
        const { guildId, userId } = this.data;
        // ...
    }
}
```

```ts title="anywhere with core"
const job = this.core.tasks.schedule(Unban, { in: '1d', data: { guildId, userId } });
this.core.tasks.cancel(job.id);
```

`in` takes a duration that seedcord's `parseDuration` reads, like `'30s'`, `'2h'` or `'1d'`. `at` takes a `Date`. `data` is typed from the class, so a missing or wrong field fails to compile, and so does `data` on a task that takes none.

## Inside a task

`execute()` takes no arguments. Like a `Subscriber`, everything is on `this`:

| member      | holds                                                    |
| ----------- | -------------------------------------------------------- |
| `data`      | the scheduled payload, typed from `Task<TData>`          |
| `core`      | the bot's `Core`, with the client and your plugins       |
| `logger`    | logs under the task's key, on the plugin's channel       |
| `signal`    | aborts when the bot shuts down. Pass it to anything slow |
| `startedAt` | when this run started                                    |
| `trigger`   | `'cron'`, `'scheduled'` or `'manual'`                    |

Each run gets a fresh instance, as subscribers do, so a field doesn't keep its value between runs. A task can also write `onError(error)` and `onOverrun()`.

Import `Task` from the subpath for your transport, `/gateway` here, to type `this.core` as your bot's `Core`. That's how `@seedcord/gateway` types `Subscriber`. The generic `Task<TData, TCore>` is in the root, and an http bot would get `/http` the same way.

## Controlling tasks

Everything takes the class, not a name:

```ts
this.core.tasks.pause(Heartbeat);
this.core.tasks.resume(Heartbeat);
this.core.tasks.nextRun(Heartbeat);
await this.core.tasks.trigger(Heartbeat); // runs now, outside the schedule
this.core.tasks.list(); // cron tasks and their state
this.core.tasks.jobs(); // pending scheduled jobs
```

`trigger()` only takes tasks without data. `pause`, `resume` and `nextRun` throw for a task without a pattern.

## Checked at compile time

The decorator checks a literal pattern and timezone without codegen:

```txt output
Argument of type '"61 * * * *"' is not assignable to parameter of type
'"Invalid cron pattern '61 * * * *': minute '61' is outside 0-59"'.

Type '"Europe/Sarajvo"' is not assignable to type
'"'Europe/Sarajvo' is not an IANA timezone. Write one like 'Europe/Sarajevo' or 'UTC'"'.
```

The pattern check follows croner's default grammar: 5, 6 or 7 fields, `*`, `?`, lists, ranges, `*/S` and `N-M/S` steps, month and weekday names, `L`, `LW` and `NW` in day of month, `NL`, `N#K` and a leading `+` in day of week, and croner's nicknames. It checks each value against its field's range, each step against the field's size, and that each range runs low to high. It asks for single spaces where croner allows several. croner still parses every pattern at startup, so anything the types let through still gets caught then.

`timezones.ts` lists 467 names, every IANA zone that both Node and Bun accept. It includes old names like `Europe/Kiev` and new ones like `Europe/Kyiv`. A non-literal `string`, such as one read from `.env`, skips both checks and gets validated at startup.

## How it behaves

- **Loading.** `init()` imports every file under `path` and keeps exported classes that extend `Task` and carry `@RegisterTask`. A bad pattern, a bad timezone or two tasks with the same key stop startup and name the file.
- **Keys.** Each task has a key, its class name unless `key` sets one. Callers never see it. It's what a stored job will point at once `Store` lands, so set `key` on scheduled tasks to keep pending jobs working through a rename.
- **Starting.** Cron tasks start in `ready()`, once the client has logged in.
- **Overlap.** With `protect` on, a cron run that fires while the last one is still going gets skipped, and the plugin calls `onOverrun()`. Manual `trigger()` runs follow the same rule.
- **Scheduled jobs.** They're held in memory for now. A date in the past runs right away. `data` goes through `structuredClone`, so data that can't be stored, like a function, throws when you schedule it.
- **Errors.** A throw in `execute()` gets logged and published as `taskFailed` on the bus, then the plugin calls `onError()`. A successful run publishes `taskFinished`. That's the hook for Sentry or a webhook.
- **Shutdown.** `dispose()` runs in `Drain`, not `Disconnect`. It stops every schedule, logs how many pending jobs it dropped, aborts the signal and waits for in-flight runs, so a run that's writing to a database finishes before the database plugin disconnects.
- **Hot reload.** Under `seedcord dev`, saving a task file swaps in the new class. Pending jobs look their task up by key when they fire, so they run the new code.
- **Where it runs.** It extends `@seedcord/core/plugin` with `runtime: 'server'`, so it works on gateway bots and on http bots running on Node or Bun, but not on Workers.

## Open questions for review

1. **Persistence.** Scheduled jobs wait on the reworked `Store`. Until then they're lost on restart, and the plugin says so at shutdown.
2. **A subpath per transport.** `this.core` is typed through `/gateway` and a future `/http`, the same way seedcord types handlers. Is that fine for a plugin package?
3. **Log channel.** `Plugin` doesn't expose its attach key or log channel, so the plugin finds its own key by looking for itself on `core`. A public getter on `Plugin` would remove the workaround.
4. **`protect` on by default.** The Sapphire plugin defaults to off. Overlapping runs are almost always a bug in a bot, so this draft defaults to on.
5. **The timezone list.** `timezones.ts` is generated from the runtimes' ICU data, so it needs a regenerate when a zone gets added. The plugin-level `timezone` option takes only that list, so a value from `.env` needs a cast there.
