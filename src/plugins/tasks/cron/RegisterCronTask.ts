import type { CronTask } from './CronTask';
import type { CronPattern } from './pattern';
import type { CronTaskContext, CronTaskOptions } from './types';

export type CronTaskClass = new (context: CronTaskContext) => CronTask;

export interface CronTaskMetadata extends CronTaskOptions {
    pattern: string;
}

const registry = new WeakMap<object, CronTaskMetadata>();

export function RegisterCronTask<const TPattern extends string, const TZone extends string = string>(
    pattern: CronPattern<TPattern>,
    options: CronTaskOptions<TZone> = {}
) {
    return (target: abstract new (context: CronTaskContext) => CronTask): void => {
        registry.set(target, { ...options, pattern });
    };
}

export function cronTaskMetadata(target: object): CronTaskMetadata | undefined {
    return registry.get(target);
}
