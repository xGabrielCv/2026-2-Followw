"""Cardápio sintético sem rede para os testes de navegador."""

from datetime import date, timedelta

from unb_browser import DailyMenu, MenuSection


class SimulatedRestaurant:
    async def get_menu(self, campus):
        monday = date.today() - timedelta(days=date.today().weekday())
        meal = (
            MenuSection(
                key="main_dish", name="Prato principal", items=("Refeição sintética",)
            ),
        )
        return [
            DailyMenu(
                date=monday + timedelta(days=i), breakfast=meal, lunch=meal, dinner=meal
            )
            for i in range(7)
        ]


class SimulatedBrowser:
    restaurant = SimulatedRestaurant()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None
