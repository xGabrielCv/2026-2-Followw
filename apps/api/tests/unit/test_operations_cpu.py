import importlib
from types import SimpleNamespace


def test_cpu_utiliza_intervalo_entre_amostras_em_vez_de_zerar_sempre(monkeypatch):
    from api.modules.admin import operations

    class Process:
        def __init__(self, pid):
            self.pid, self.samples = pid, 0

        def cpu_percent(self, interval=None):
            self.samples += 1
            return 0 if self.samples == 1 else 23

        def memory_info(self):
            return SimpleNamespace(rss=1024)

        def children(self, recursive=False):
            return []

        def parent(self):
            return None

        def num_threads(self):
            return 1

    try:
        with monkeypatch.context() as patch:
            patch.setattr(operations.psutil, "Process", Process)
            importlib.reload(operations)
            assert operations._process()["cpu_percent"] == 0
            assert operations._process()["cpu_percent"] == 23
    finally:
        importlib.reload(operations)
