# tasks plugin (draft)

A draft of a seedcord plugin for jobs that run on their own, without a command. It's laid out as the package the maintainers suggested, one package with a subpath per kind of task:

| subpath      | what it runs                                                             | state       |
| ------------ | ------------------------------------------------------------------------ | ----------- |
| `/cron`      | classes on a repeating cron pattern, in memory, through croner           | this code   |
| `/scheduled` | one-off or delayed jobs with a payload, stored so they survive a restart | not started |

In this bot `#plugins/tasks/cron` stands in for `@seedcord/plugin-tasks/cron`.

## Using `/cron`

Attach the plugin with the folder your tasks live in:

```ts title="src/bot.ts"
import { CronTasks } from '#plugins/tasks/cron';

export default seedcord.attach('cron', CronTasks, { dir: './cron-tasks', timezone: 'UTC' });
```

Write one class per task. The decorator gives it its schedule, and `run()` is the job:

```ts title="src/cron-tasks/Heartbeat.ts"
import { CronTask, RegisterCronTask } from '#plugins/tasks/cron/gateway';

@RegisterCronTask('* * * * *')
export class Heartbeat extends CronTask {
    public async run(): Promise<void> {
        this.logger.info(`${this.core.bot.client.guilds.cache.size} servers`);
    }
}
```

Import tasks from the subpath for your transport, `/cron/gateway` here, so `this.core` is your bot's full `Core` with the client and your plugins on it. This is how seedcord does it too. The generic `CronTask<TCore>` lives in `/cron`, and each transport's subpath re-exports it with that transport's `Core` filled in, just as `@seedcord/gateway` does with `Subscriber`. An http bot would get `/cron/http` the same way, with `@seedcord/http` as an optional peer dependency.

`@RegisterCronTask(pattern, options?)` takes `name` (defaults to the class name), `timezone`, `protect` (on by default), `paused`, `maxRuns`, `startAt` and `stopAt`.

`run()` gets `{ signal, startedAt, trigger }`. `signal` aborts when the bot shuts down. A task can also write `onError(error, context)` and `onOverrun()`.

From anywhere with `core`, `this.core.cron` has `list()`, `has()`, `nextRun()`, `pause()`, `resume()` and `trigger()`.

### Checked at compile time

The decorator checks a literal pattern and timezone without codegen. A mistake fails to compile, and the error says what's wrong:

```txt output
Argument of type '"61 * * * *"' is not assignable to parameter of type
'"Invalid cron pattern '61 * * * *': minute '61' is outside 0-59"'.

Type '"Europe/Sarajvo"' is not assignable to type
'"'Europe/Sarajvo' is not an IANA timezone. Write one like 'Europe/Sarajevo' or 'UTC'"'.
```

The pattern check follows croner's default grammar: 5, 6 or 7 fields, `*`, `?`, lists, ranges, `*/S` and `N-M/S` steps, month and weekday names, `L`, `LW` and `NW` in day of month, `NL`, `N#K` and a leading `+` in day of week, and croner's nicknames. It checks each value against its field's range, each step against the field's size, and that each range runs low to high. It asks for single spaces where croner allows several. croner still parses every pattern when the bot starts, so anything the types let through still gets caught then.

`timezones.ts` lists 467 names, every IANA zone that both Node and Bun accept. It includes old names like `Europe/Kiev` and new ones like `Europe/Kyiv`. A non-literal `string`, such as one read from `.env`, skips both checks and gets validated at startup.

## How it behaves

- **Loading.** `init()` imports every file under `dir` and keeps exported classes that extend `CronTask` and carry the decorator. A bad pattern, a bad timezone or two tasks with the same name stop startup and name the file.
- **Starting.** Every task is created paused and starts in `ready()`, once the client has logged in, so a run can't reach a client that isn't connected yet.
- **Overlap.** With `protect` on, a run that fires while the last one is still going gets skipped, and the plugin calls `onOverrun()`. Manual `trigger()` runs follow the same rule.
- **Errors.** A throw in `run()` gets logged and published as `cronTaskFailed` on the bus, then the plugin calls `onError()`. A successful run publishes `cronTaskFinished` with its duration. That's the hook for Sentry or a webhook, so the plugin doesn't depend on either.
- **Shutdown.** `dispose()` runs in `Drain`, not `Disconnect`. It stops every schedule, aborts the signal and waits for in-flight runs, so a run that's writing to a database finishes before the database plugin disconnects.
- **Hot reload.** Under `seedcord dev`, saving a task file stops its old job and schedules the new class without a restart.
- **Where it runs.** It extends `@seedcord/core/plugin` with `runtime: 'server'`, so it works on gateway bots and on http bots running on Node or Bun. It doesn't run on Workers, which have no long-lived timers. Cloudflare's own cron triggers would be a separate design.

## Open questions for review

1. **A subpath per transport.** `this.core` is typed through `/cron/gateway` and a future `/cron/http`, the same way seedcord types handlers. Is a subpath per transport fine for a plugin package, or should the generic `CronTask<Core>` be the only way?
2. **Task names.** Methods like `pause()` take a plain string. Mongoose uses a hand-written registry interface to type its keys. Is that worth the extra `declare module` block here?
3. **Log channel.** `Plugin` doesn't expose its attach key or log channel, so the plugin finds its own key by looking for itself on `core`. That way each task's logger prints on the plugin's channel under the task's name. A public getter on `Plugin` would remove the workaround.
4. **`protect` on by default.** The Sapphire plugin defaults to off. Overlapping runs are almost always a bug in a bot, so this draft defaults to on.
5. **Date patterns.** croner accepts a `Date` for a one-off run. This draft rejects it, because a one-off job belongs in `/scheduled`.
6. **The timezone list.** `timezones.ts` is generated from the runtimes' ICU data, so it needs a regenerate when a zone gets added. The plugin-level `timezone` option takes only that list, so a value from `.env` needs a cast there. Should it take any string instead?
