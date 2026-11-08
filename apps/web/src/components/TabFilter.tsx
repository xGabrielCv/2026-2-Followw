import { Button } from '#/components/ui/button';
import { cn } from '#/lib/shadcn';

interface TabFilterProps<T extends string> {
    label: string;
    value: T | undefined;
    options: readonly T[];
    labels?: Partial<Record<T, string>>;
    onChange: (value: T) => void;
    className?: string;
    // classe extra de uma opção, como o verde do semestre futuro
    optionClassName?: (option: T) => string | undefined;
}

export function TabFilter<T extends string>({
    label,
    value,
    options,
    labels,
    onChange,
    className,
    optionClassName
}: TabFilterProps<T>) {
    return (
        <fieldset
            className={cn(
                'flex items-center gap-1 overflow-x-auto py-1 max-md:no-scrollbar',
                className
            )}
            aria-label={label}
        >
            {options.map((option) => (
                <Button
                    key={option}
                    variant={option === value ? 'secondary' : 'ghost'}
                    aria-pressed={option === value}
                    onClick={() => onChange(option)}
                    className={cn('shrink-0', optionClassName?.(option))}
                >
                    {labels?.[option] ?? option}
                </Button>
            ))}
        </fieldset>
    );
}
