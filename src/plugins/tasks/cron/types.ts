import type { IanaTimezone, Timezone } from './timezones';
import type { CoreBase } from '@seedcord/core';
import type { Logger } from '@seedcord/logger';

export interface CronTasksOptions {
    dir: string;
    timezone?: IanaTimezone;
}

export interface CronTaskOptions<TZone extends string = string> {
    name?: string;
    timezone?: Timezone<TZone>;
    /** @defaultValue `true` */
    protect?: boolean;
    /** @defaultValue `false` */
    paused?: boolean;
    maxRuns?: number;
    startAt?: Date | string;
    stopAt?: Date | string;
}

export type CronTrigger = 'schedule' | 'manual';

export interface CronRunContext {
    signal: AbortSignal;
    startedAt: Date;
    trigger: CronTrigger;
}

export interface CronTaskContext {
    core: CoreBase;
    logger: Logger;
    name: string;
    pattern: string;
}

export interface CronTaskStatus {
    name: string;
    pattern: string;
    timezone: string | undefined;
    scheduled: boolean;
    busy: boolean;
    nextRun: Date | null;
    previousRun: Date | null;
}

declare module '@seedcord/core' {
    interface Subscriptions {
        cronTaskFinished: { name: string; trigger: CronTrigger; durationMs: number };
        cronTaskFailed: { name: string; trigger: CronTrigger; durationMs: number; error: Error };
    }
}
