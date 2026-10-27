import type { CronPattern } from './pattern';
import type { Task } from './Task';
import type { TaskContext, TaskOptions } from './types';

export type TaskClass = new (context: TaskContext) => Task<unknown>;

export interface TaskMetadata extends Omit<TaskOptions, 'key'> {
    key: string;
    pattern: string | undefined;
}

const registry = new WeakMap<object, TaskMetadata>();

export function RegisterTask<const TPattern extends string, const TZone extends string = string>(
    pattern: CronPattern<TPattern>,
    options?: TaskOptions<TZone>
): (target: abstract new (context: TaskContext<void>) => Task) => void;

export function RegisterTask(
    options?: Pick<TaskOptions, 'key'>
): (target: abstract new (context: never) => Task<unknown>) => void;

export function RegisterTask(patternOrOptions: string | Pick<TaskOptions, 'key'> = {}, options: TaskOptions = {}) {
    return (target: { readonly name: string }): void => {
        const metadata: TaskMetadata =
            typeof patternOrOptions === 'string'
                ? { ...options, key: options.key ?? target.name, pattern: patternOrOptions }
                : { key: patternOrOptions.key ?? target.name, pattern: undefined };

        registry.set(target, metadata);
    };
}

export function taskMetadata(target: object): TaskMetadata | undefined {
    return registry.get(target);
}

export function taskKey(target: { readonly name: string }): string {
    const metadata = taskMetadata(target);
    return metadata ? metadata.key : target.name;
}
