import type { TaskContext, TaskTrigger } from './types';
import type { CoreBase } from '@seedcord/core';
import type { Logger } from '@seedcord/logger';

export abstract class Task<TData = void, TCore extends CoreBase = CoreBase> {
    public readonly key: string;
    protected readonly core: TCore;
    protected readonly logger: Logger;
    protected readonly data: TData;
    protected readonly signal: AbortSignal;
    protected readonly startedAt: Date;
    protected readonly trigger: TaskTrigger;

    public constructor(context: TaskContext<TData>) {
        this.key = context.key;
        this.core = context.core as TCore;
        this.logger = context.logger;
        this.data = context.data;
        this.signal = context.signal;
        this.startedAt = context.startedAt;
        this.trigger = context.trigger;
    }

    public abstract execute(): Promise<void>;

    public onError?(error: Error): Promise<void>;

    public onOverrun?(): Promise<void>;
}
