import { Link } from '@tanstack/react-router';
import { Coffee, Soup, UtensilsCrossed } from 'lucide-react';

import type { Day } from '#/lib/schedule';
import type { Campus, DailyMenu, MenuSection } from '#/queries/restaurant';

import { LoadingText } from '#/components/LoadingText';
import { SectionHeader } from '#/components/SectionHeader';
import { Card } from '#/components/ui/card';
import { highlightMenu, previewMenuMeals, formatMenuDay } from '#/lib/restaurant';
import { CAMPUS_LABELS } from '#/queries/restaurant';

interface PublicInfoSectionProps {
    campus: Campus;
    menu?: DailyMenu;
    isLoading?: boolean;
    // rótulo do dia exibido: "Hoje", "Quarta-feira"...
    day: string;
    menus?: DailyMenu[];
    date?: string;
    now?: Day & { time: string };
}

function mainDish(sections: MenuSection[] | null | undefined) {
    if (!sections?.length) return undefined;
    const section = highlightMenu(sections).main ?? sections[0];
    return section.items.join(', ');
}

export const PublicInfoSection: React.FC<PublicInfoSectionProps> = ({
    campus,
    menu,
    isLoading,
    day,
    menus,
    date,
    now
}) => {
    const preview = menus && date && now ? previewMenuMeals(menus, date, now) : null;
    const meals = (
        preview
            ? preview.map((meal) => ({
                  label: meal.key === 'breakfast' ? 'Café' : meal.label,
                  icon:
                      meal.key === 'breakfast'
                          ? Coffee
                          : meal.key === 'lunch'
                            ? UtensilsCrossed
                            : Soup,
                  dish: meal.dish
              }))
            : [
                  { label: 'Café', icon: Coffee, dish: mainDish(menu?.breakfast) },
                  { label: 'Almoço', icon: UtensilsCrossed, dish: mainDish(menu?.lunch) },
                  { label: 'Jantar', icon: Soup, dish: mainDish(menu?.dinner) }
              ]
    ).filter((meal) => meal.dish);
    const shownDay =
        preview?.[0] && date && preview[0].date !== date
            ? formatMenuDay(preview[0].date, date)
            : day;

    return (
        <section aria-label="RU">
            <SectionHeader title="RU" actionLabel="Ver Cardápio" actionTo="/ru" />
            <Card size="sm" className="relative gap-2 px-3">
                <Link
                    to="/ru"
                    aria-label="Ver cardápio do RU"
                    className="absolute inset-0 rounded-2xl transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                />
                <div className="pointer-events-none relative flex items-baseline gap-2 text-xs">
                    <span className="font-semibold text-primary">
                        Pratos principais · {shownDay}
                    </span>
                    <span className="ml-auto truncate font-medium text-muted-foreground">
                        Campus {CAMPUS_LABELS[campus]}
                    </span>
                </div>
                {meals.length > 0 ? (
                    <dl className="pointer-events-none relative flex flex-col gap-1.5">
                        {meals.map((meal) => (
                            <div key={meal.label} className="flex items-center gap-2">
                                <meal.icon
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <dt className="w-12 shrink-0 text-xs text-muted-foreground">
                                    {meal.label}
                                </dt>
                                <dd className="min-w-0 truncate text-sm font-semibold">
                                    {meal.dish}
                                </dd>
                            </div>
                        ))}
                    </dl>
                ) : (
                    <p className="pointer-events-none relative text-xs text-muted-foreground">
                        {isLoading ? (
                            <LoadingText>Carregando cardápio...</LoadingText>
                        ) : (
                            `Cardápio de ${day.toLowerCase()} não publicado.`
                        )}
                    </p>
                )}
            </Card>
        </section>
    );
};
