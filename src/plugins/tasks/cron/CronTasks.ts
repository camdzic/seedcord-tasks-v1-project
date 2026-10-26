import { ShutdownPhase } from '@seedcord/core';
import { HmrModuleHandler } from '@seedcord/core/hmr';
import { Plugin } from '@seedcord/core/plugin';
import { Logger } from '@seedcord/logger';
import { importFiles } from '@seedcord/utils';
import { Cron } from 'croner';

import { CronTask } from './CronTask';
import { cronTaskMetadata } from './RegisterCronTask';

import type { CronTaskClass, CronTaskMetadata } from './RegisterCronTask';
import type { CronRunContext, CronTasksOptions, CronTaskStatus, CronTrigger } from './types';
import type { CoreBase } from '@seedcord/core';
import type { HmrUpdateEvent } from '@seedcord/core/plugin';

interface Entry {
    readonly task: CronTask;
    readonly job: Cron;
    readonly meta: CronTaskMetadata;
    readonly timezone: string | undefined;
    current: Promise<void> | undefined;
}

const isCronTaskClass = (value: unknown): value is CronTaskClass =>
    typeof value === 'function' && value.prototype instanceof CronTask && cronTaskMetadata(value) !== undefined;

const isTimezone = (timezone: string): boolean => {
    try {
        return new Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone.length > 0;
    } catch {
        return false;
    }
};

const toError = (thrown: unknown): Error => (Error.isError(thrown) ? thrown : new Error(String(thrown)));

export class CronTasks extends Plugin<{ runtime: 'server' }> {
    private readonly entries = new Map<string, Entry>();
    private readonly reloader: HmrModuleHandler<CronTaskClass, void, string>;
    private readonly classes = new Map<CronTaskClass, string>();
    private readonly shutdown = new AbortController();
    private channel = 'plugins';
    private started = false;

    public constructor(
        host: CoreBase,
        private readonly options: CronTasksOptions
    ) {
        // Drain, so in-flight runs finish before database plugins disconnect
        super(host, { runtime: 'server', dispose: { phase: ShutdownPhase.Drain } });

        if (options.dir.length === 0) this.rejectOptions('dir is empty');
        if (options.timezone !== undefined && !isTimezone(options.timezone)) {
            this.rejectOptions(`timezone '${options.timezone}' is not an IANA timezone`);
        }

        this.reloader = new HmrModuleHandler<CronTaskClass, void, string>({
            handlersDir: options.dir,
            isHandler: isCronTaskClass,
            registerHandler: (ctor, file) => this.register(ctor, file),
            getArtifacts: (ctor) => this.classes.get(ctor) ?? '',
            unregisterHandler: (ctor, name) => this.unregister(ctor, name),
            logger: this.logger
        });
    }

    public async init(): Promise<void> {
        this.channel = this.findChannel();

        for await (const { fullPath, relativePath, imported } of importFiles(this.options.dir)) {
            for (const ctor of Object.values(imported).filter(isCronTaskClass)) {
                this.register(ctor, relativePath);
                this.reloader.trackHandler(fullPath, ctor);
            }
        }

        this.logger.info(`loaded ${this.entries.size} cron tasks`);
    }

    public override async ready(): Promise<void> {
        this.started = true;
        for (const entry of this.entries.values()) {
            if (!entry.meta.paused) entry.job.resume();
        }
        await Promise.resolve();
    }

    public override async dispose(): Promise<void> {
        for (const entry of this.entries.values()) entry.job.stop();
        this.shutdown.abort();

        await Promise.allSettled([...this.entries.values()].flatMap((entry) => entry.current ?? []));
    }

    public override async onHmr(event: HmrUpdateEvent): Promise<void> {
        await this.reloader.handle(event);
    }

    public list(): CronTaskStatus[] {
        return [...this.entries.values()].map(({ task, job, timezone, current }) => ({
            name: task.name,
            pattern: task.pattern,
            timezone,
            scheduled: job.isRunning(),
            busy: current !== undefined,
            nextRun: job.nextRun(),
            previousRun: job.previousRun()
        }));
    }

    public has(name: string): boolean {
        return this.entries.has(name);
    }

    public nextRun(name: string): Date | null {
        return this.entry(name).job.nextRun();
    }

    public pause(name: string): void {
        this.entry(name).job.pause();
    }

    public resume(name: string): void {
        const entry = this.entry(name);
        if (this.started) entry.job.resume();
    }

    public async trigger(name: string): Promise<void> {
        await this.execute(this.entry(name), 'manual');
    }

    private entry(name: string): Entry {
        const entry = this.entries.get(name);
        if (!entry) throw new Error(`No cron task named '${name}'. Loaded: ${[...this.entries.keys()].join(', ')}`);
        return entry;
    }

    private register(Task: CronTaskClass, file: string): void {
        const meta = cronTaskMetadata(Task);
        if (!meta) return;

        const name = meta.name ?? Task.name;
        if (this.entries.has(name)) {
            throw new Error(`Two cron tasks are named '${name}'. Rename the one in ${file} or pass a name.`);
        }

        const timezone = meta.timezone ?? this.options.timezone;
        if (timezone !== undefined && !isTimezone(timezone)) {
            throw new Error(
                `Cron task '${name}' in ${file} has timezone '${timezone}', which is not an IANA timezone.`
            );
        }

        // croner treats a string with a colon as a one-off date
        if (meta.pattern.includes(':')) {
            throw new Error(
                `Cron task '${name}' in ${file} has '${meta.pattern}', which is a date, not a cron pattern.`
            );
        }

        let job: Cron;

        try {
            job = new Cron(
                meta.pattern,
                {
                    name,
                    paused: true,
                    ...(timezone !== undefined && { timezone }),
                    ...(meta.maxRuns !== undefined && { maxRuns: meta.maxRuns }),
                    ...(meta.startAt !== undefined && { startAt: meta.startAt }),
                    ...(meta.stopAt !== undefined && { stopAt: meta.stopAt })
                },
                async () => {
                    const entry = this.entries.get(name);
                    if (entry) await this.execute(entry, 'schedule');
                }
            );
        } catch (error) {
            throw new Error(`Cron task '${name}' in ${file} has an invalid pattern '${meta.pattern}'.`, {
                cause: error
            });
        }

        const task = new Task({
            core: this.core,
            logger: new Logger(name, { channel: this.channel }),
            name,
            pattern: meta.pattern
        });

        this.entries.set(name, { task, job, meta, timezone, current: undefined });
        this.classes.set(Task, name);

        if (this.started && !meta.paused) job.resume();

        this.logger.debug(`registered ${name} from ${file} on '${meta.pattern}'`);
    }

    private unregister(ctor: CronTaskClass, name: string | undefined): void {
        this.classes.delete(ctor);

        if (name === undefined) return;

        this.entries.get(name)?.job.stop();
        this.entries.delete(name);
    }

    private async execute(entry: Entry, trigger: CronTrigger): Promise<void> {
        const { task } = entry;

        if (entry.current && entry.meta.protect !== false) {
            this.logger.warn(`skipped a run of ${task.name}, the previous one is still going`);

            await task
                .onOverrun?.()
                .catch((error: unknown) => this.logger.error(`${task.name}.onOverrun threw`, error));

            return;
        }

        const context: CronRunContext = { signal: this.shutdown.signal, startedAt: new Date(), trigger };
        const run = this.runOnce(task, context);

        entry.current = run;

        try {
            await run;
        } finally {
            if (entry.current === run) entry.current = undefined;
        }
    }

    private async runOnce(task: CronTask, context: CronRunContext): Promise<void> {
        const { name } = task;
        const { trigger } = context;

        try {
            await task.run(context);

            this.core.bus.publish('cronTaskFinished', {
                name,
                trigger,
                durationMs: Date.now() - context.startedAt.getTime()
            });
        } catch (thrown) {
            const error = toError(thrown);
            const durationMs = Date.now() - context.startedAt.getTime();

            this.logger.error(`${name} threw after ${durationMs}ms`, error);
            this.core.bus.publish('cronTaskFailed', { name, trigger, durationMs, error });

            await task
                .onError?.(error, context)
                .catch((inner: unknown) => this.logger.error(`${name}.onError threw`, inner));
        }
    }

    private findChannel(): string {
        for (const key of Object.keys(this.core)) {
            let value: unknown;

            try {
                value = Reflect.get(this.core, key);
            } catch {
                continue;
            }

            if (value === this) return key;

            if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
                for (const [leaf, nested] of Object.entries(value)) {
                    if (nested === this) return `${key}.${leaf}`;
                }
            }
        }

        return 'plugins';
    }
}
