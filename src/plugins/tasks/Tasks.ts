import { randomUUID } from 'node:crypto';

import { ShutdownPhase } from '@seedcord/core';
import { HmrModuleHandler } from '@seedcord/core/hmr';
import { Plugin } from '@seedcord/core/plugin';
import { Logger } from '@seedcord/logger';
import { importFiles } from '@seedcord/utils';
import { Cron } from 'croner';

import { findAttachKey, isTimezone, parseAt, parseIn, toError } from './helpers';
import { taskKey, taskMetadata } from './RegisterTask';
import { Task } from './Task';

import type { TaskClass, TaskMetadata } from './RegisterTask';
import type { CronStatus, ScheduledJob, ScheduleOptions, TaskContext, TasksOptions, TaskTrigger, When } from './types';
import type { CoreBase, Subscriptions } from '@seedcord/core';
import type { HmrUpdateEvent } from '@seedcord/core/plugin';

interface Registered {
    readonly key: string;
    readonly Task: TaskClass;
    readonly meta: TaskMetadata;
    readonly logger: Logger;
}

interface CronEntry {
    readonly job: Cron;
    readonly timezone: string | undefined;
    readonly paused: boolean;
    readonly protect: boolean;
    current: Promise<void> | undefined;
}

interface Pending {
    readonly id: string;
    readonly key: string;
    readonly at: Date;
    readonly data: unknown;
    timer: NodeJS.Timeout | undefined;
}

type FailedRun = Omit<Subscriptions['taskFailed'], 'durationMs' | 'error'> & { startedAt: number };
type AnyTaskClass = abstract new (context: never) => Task<unknown>;
type VoidTaskClass = abstract new (context: TaskContext<void>) => Task;
type DataOf<TTask> = TTask extends abstract new (context: TaskContext<infer TData>) => unknown ? TData : never;

// setTimeout overflows past this, so longer waits re-arm in steps
const MAX_TIMEOUT_MS = 2_147_483_647;

const isTaskClass = (value: unknown): value is TaskClass =>
    typeof value === 'function' && value.prototype instanceof Task && taskMetadata(value) !== undefined;

export class Tasks extends Plugin<{ runtime: 'server' }> {
    private readonly tasks = new Map<string, Registered>();
    private readonly crons = new Map<string, CronEntry>();
    private readonly pending = new Map<string, Pending>();
    private readonly running = new Set<Promise<void>>();
    private readonly reloader: HmrModuleHandler<TaskClass, void, string>;
    private readonly shutdown = new AbortController();
    private channel = 'plugins';
    private started = false;

    public constructor(
        host: CoreBase,
        private readonly options: TasksOptions
    ) {
        // Drain, so in-flight runs finish before database plugins disconnect
        super(host, { runtime: 'server', dispose: { phase: ShutdownPhase.Drain } });

        if (options.path.length === 0) this.rejectOptions('path is empty');
        if (options.timezone !== undefined && !isTimezone(options.timezone)) {
            this.rejectOptions(`timezone '${options.timezone}' is not an IANA timezone`);
        }

        this.reloader = new HmrModuleHandler<TaskClass, void, string>({
            handlersDir: options.path,
            isHandler: isTaskClass,
            registerHandler: (Task, file) => this.register(Task, file),
            getArtifacts: (Task) => taskKey(Task),
            unregisterHandler: (_Task, key) => this.unregister(key),
            logger: this.logger
        });
    }

    public async init(): Promise<void> {
        this.channel = findAttachKey(this.core, this) ?? 'plugins';

        for await (const { fullPath, relativePath, imported } of importFiles(this.options.path)) {
            for (const Task of Object.values(imported).filter(isTaskClass)) {
                this.register(Task, relativePath);
                this.reloader.trackHandler(fullPath, Task);
            }
        }

        this.logger.info(`loaded ${this.tasks.size} tasks, ${this.crons.size} on a cron pattern`);
    }

    public override async ready(): Promise<void> {
        this.started = true;

        for (const entry of this.crons.values()) {
            if (!entry.paused) entry.job.resume();
        }

        await Promise.resolve();
    }

    public override async dispose(): Promise<void> {
        for (const entry of this.crons.values()) entry.job.stop();
        for (const job of this.pending.values()) clearTimeout(job.timer);

        if (this.pending.size > 0) {
            this.logger.warn(
                `dropped ${this.pending.size} scheduled job${this.pending.size === 1 ? '' : 's'}. Scheduled jobs live in memory until a store is supported`
            );
        }

        this.pending.clear();
        this.shutdown.abort();

        await Promise.allSettled(this.running);
    }

    public override async onHmr(event: HmrUpdateEvent): Promise<void> {
        await this.reloader.handle(event);
    }

    public schedule<TTask extends AnyTaskClass, const TIn extends string = string>(
        Task: TTask,
        options: ScheduleOptions<DataOf<TTask>, TIn>
    ): ScheduledJob {
        const key = this.registered(Task).key;
        const when: When = options;
        const at = when.in === undefined ? parseAt(when.at) : new Date(Date.now() + parseIn(when.in));

        if (Number.isNaN(at.getTime())) throw new Error(`Scheduled ${key} with an invalid date.`);

        // jobs will be stored once Store lands, so the data has to survive a round trip already
        const data: unknown = 'data' in options ? structuredClone(options.data) : undefined;
        const job: Pending = { id: randomUUID(), key, at, data, timer: undefined };

        this.pending.set(job.id, job);
        this.arm(job);

        return { id: job.id, key, at };
    }

    public cancel(id: string): boolean {
        const job = this.pending.get(id);
        if (!job) return false;

        clearTimeout(job.timer);

        return this.pending.delete(id);
    }

    public jobs(): ScheduledJob[] {
        return [...this.pending.values()].map(({ id, key, at }) => ({ id, key, at }));
    }

    public list(): CronStatus[] {
        return [...this.crons].map(([key, { job, timezone, current }]) => ({
            key,
            pattern: job.getPattern() ?? '',
            timezone,
            scheduled: job.isRunning(),
            busy: current !== undefined,
            nextRun: job.nextRun(),
            previousRun: job.previousRun()
        }));
    }

    public nextRun(Task: VoidTaskClass): Date | null {
        return this.cron(Task).job.nextRun();
    }

    public pause(Task: VoidTaskClass): void {
        this.cron(Task).job.pause();
    }

    public resume(Task: VoidTaskClass): void {
        const entry = this.cron(Task);

        if (this.started) entry.job.resume();
    }

    public async trigger(Task: VoidTaskClass): Promise<void> {
        const { key } = this.registered(Task);

        if (this.crons.has(key)) await this.runCron(key, 'manual');
        else await this.run(key, 'manual', undefined, null);
    }

    private registered(Task: { readonly name: string }): Registered {
        const key = taskKey(Task);
        const registered = this.tasks.get(key);

        if (!registered)
            throw new Error(`${key} isn't a loaded task. Put it under ${this.options.path} with @RegisterTask.`);

        return registered;
    }

    private cron(Task: VoidTaskClass): CronEntry {
        const { key } = this.registered(Task);

        const entry = this.crons.get(key);

        if (!entry) throw new Error(`${key} has no cron pattern. Pass one to @RegisterTask to pause or resume it.`);

        return entry;
    }

    private register(Task: TaskClass, file: string): void {
        const meta = taskMetadata(Task);
        if (!meta) return;

        const key = taskKey(Task);
        const existing = this.tasks.get(key);

        if (existing && existing.Task !== Task) {
            throw new Error(`Two tasks use the key '${key}'. Rename the one in ${file} or pass a key.`);
        }

        if (meta.pattern !== undefined) this.registerCron(key, meta, file);

        this.tasks.set(key, { key, Task, meta, logger: new Logger(key, { channel: this.channel }) });
        this.logger.debug(`registered ${key} from ${file}${meta.pattern ? ` on '${meta.pattern}'` : ''}`);
    }

    private registerCron(key: string, meta: TaskMetadata, file: string): void {
        const pattern = meta.pattern ?? '';
        const timezone = meta.timezone ?? this.options.timezone;

        if (timezone !== undefined && !isTimezone(timezone)) {
            throw new Error(`Task '${key}' in ${file} has timezone '${timezone}', which is not an IANA timezone.`);
        }

        // croner treats a string with a colon as a one-off date
        if (pattern.includes(':')) {
            throw new Error(`Task '${key}' in ${file} has '${pattern}', which is a date, not a cron pattern.`);
        }

        let job: Cron;

        try {
            job = new Cron(
                pattern,
                {
                    paused: true,
                    ...(timezone !== undefined && { timezone }),
                    ...(meta.maxRuns !== undefined && { maxRuns: meta.maxRuns }),
                    ...(meta.startAt !== undefined && { startAt: meta.startAt }),
                    ...(meta.stopAt !== undefined && { stopAt: meta.stopAt })
                },
                () => this.runCron(key, 'cron')
            );
        } catch (error) {
            throw new Error(`Task '${key}' in ${file} has an invalid pattern '${pattern}'.`, { cause: error });
        }

        const { paused = false, protect = true } = meta;
        this.crons.set(key, { job, timezone, paused, protect, current: undefined });

        if (this.started && !meta.paused) job.resume();
    }

    private unregister(key: string | undefined): void {
        if (key === undefined) return;

        const cron = this.crons.get(key);

        if (cron) {
            cron.job.stop();
            this.crons.delete(key);
        }

        this.tasks.delete(key);
    }

    private arm(job: Pending): void {
        const wait = Math.min(Math.max(job.at.getTime() - Date.now(), 0), MAX_TIMEOUT_MS);

        job.timer = setTimeout(() => {
            if (job.at.getTime() > Date.now()) {
                this.arm(job);
                return;
            }

            this.pending.delete(job.id);

            void this.run(job.key, 'scheduled', job.data, job.id);
        }, wait);
    }

    private async runCron(key: string, trigger: TaskTrigger): Promise<void> {
        const entry = this.crons.get(key);
        if (!entry) return;

        if (entry.current && entry.protect) {
            this.logger.warn(`skipped a run of ${key}, the previous one is still going`);
            await this.overrun(key);

            return;
        }

        const run = this.run(key, trigger, undefined, null);
        entry.current = run;

        try {
            await run;
        } finally {
            if (entry.current === run) entry.current = undefined;
        }
    }

    private async overrun(key: string): Promise<void> {
        const registered = this.tasks.get(key);
        if (!registered) return;

        const task = this.instantiate(registered, 'cron', undefined);
        if (!task.onOverrun) return;

        try {
            await task.onOverrun();
        } catch (error) {
            this.logger.error(`${key}.onOverrun threw`, error);
        }
    }

    private instantiate(registered: Registered, trigger: TaskTrigger, data: unknown): Task<unknown> {
        return new registered.Task({
            core: this.core,
            logger: registered.logger,
            key: registered.key,
            data,
            signal: this.shutdown.signal,
            startedAt: new Date(),
            trigger
        });
    }

    private run(key: string, trigger: TaskTrigger, data: unknown, jobId: string | null): Promise<void> {
        const run = this.execute(key, trigger, data, jobId);

        this.running.add(run);
        void run.finally(() => this.running.delete(run));

        return run;
    }

    private async execute(key: string, trigger: TaskTrigger, data: unknown, jobId: string | null): Promise<void> {
        const registered = this.tasks.get(key);

        if (!registered) {
            this.logger.warn(`dropped a ${trigger} run of ${key}, no task with that key is loaded`);
            return;
        }

        const startedAt = Date.now();
        let task: Task<unknown>;

        try {
            task = this.instantiate(registered, trigger, data);
        } catch (thrown) {
            this.fail({ key, trigger, jobId, startedAt }, thrown);
            return;
        }

        try {
            await task.execute();

            this.core.bus.publish('taskFinished', { key, trigger, jobId, durationMs: Date.now() - startedAt });
        } catch (thrown) {
            const error = this.fail({ key, trigger, jobId, startedAt }, thrown);

            if (task.onError) {
                try {
                    await task.onError(error);
                } catch (inner) {
                    this.logger.error(`${key}.onError threw`, inner);
                }
            }
        }
    }

    private fail({ key, trigger, jobId, startedAt }: FailedRun, thrown: unknown): Error {
        const error = toError(thrown);
        const durationMs = Date.now() - startedAt;

        this.logger.error(`${key} threw after ${durationMs}ms`, error);
        this.core.bus.publish('taskFailed', { key, trigger, jobId, durationMs, error });

        return error;
    }
}
