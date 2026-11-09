import os

import uvicorn


def main():
    """Desenvolvimento local: só a própria máquina alcança a API, a menos que `API_HOST` diga outra coisa."""
    uvicorn.run(
        "api.main:app",
        host=os.environ.get("API_HOST", "127.0.0.1"),
        port=8000,
        access_log=False,
        reload=os.environ.get("ENVIRONMENT") != "production",
    )
