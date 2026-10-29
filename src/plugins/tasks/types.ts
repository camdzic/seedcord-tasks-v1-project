import type { Duration } from './duration';
import type { IanaTimezone, Timezone } from './timezones';
import type { CoreBase } from '@seedcord/core';
import type { Logger } from '@seedcord/logger';

export interface TasksOptions {
    path: string;
    timezone?: IanaTimezone;
}

export interface TaskOptions<TZone extends string = string> {
    key?: string;
    timezone?: Timezone<TZone>;
    /** @defaultValue `true` */
    protect?: boolean;
    /** @defaultValue `false` */
    paused?: boolean;
    maxRuns?: number;
    startAt?: Date | string;
    stopAt?: Date | string;
}

export type TaskTrigger = 'cron' | 'scheduled' | 'manual';

export interface TaskContext<TData = unknown> {
    core: CoreBase;
    logger: Logger;
    key: string;
    data: TData;
    signal: AbortSignal;
    startedAt: Date;
    trigger: TaskTrigger;
}

export type When<TIn extends string = string> = { in: Duration<TIn>; at?: never } | { at: Date | number; in?: never };

type HasData<TData> = [TData] extends [Exclude<TData, void>] ? true : false;

export type ScheduleOptions<TData, TIn extends string = string> = When<TIn> &
    (HasData<TData> extends true ? { data: TData } : { data?: never });

export interface CronStatus {
    key: string;
    pattern: string;
    timezone: string | undefined;
    scheduled: boolean;
    busy: boolean;
    nextRun: Date | null;
    previousRun: Date | null;
}

export interface ScheduledJob {
    id: string;
    key: string;
    at: Date;
}

declare module '@seedcord/core' {
    interface Subscriptions {
        taskFinished: { key: string; trigger: TaskTrigger; jobId: string | null; durationMs: number };
        taskFailed: { key: string; trigger: TaskTrigger; jobId: string | null; durationMs: number; error: Error };
    }
}
