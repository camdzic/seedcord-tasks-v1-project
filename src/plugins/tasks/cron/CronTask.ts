import type { CronRunContext, CronTaskContext } from './types';
import type { CoreBase } from '@seedcord/core';
import type { Logger } from '@seedcord/logger';

export abstract class CronTask<TCore extends CoreBase = CoreBase> {
    public readonly name: string;
    public readonly pattern: string;
    protected readonly core: TCore;
    protected readonly logger: Logger;

    public constructor(context: CronTaskContext) {
        this.name = context.name;
        this.pattern = context.pattern;
        this.core = context.core as TCore;
        this.logger = context.logger;
    }

    public abstract run(context: CronRunContext): Promise<void>;

    public onError?(error: Error, context: CronRunContext): Promise<void>;

    public onOverrun?(): Promise<void>;
}
