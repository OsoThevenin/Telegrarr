"""Disk widgets measure the disk downloads land on: the *arr downloads base in
arr mode, the TV library in standalone mode.

Driven over HTTP (``arr_app``). The OS boundary ``shutil.disk_usage`` is
replaced by a fake reporting a distinct size per directory.
"""
import os
import shutil

import pytest

GB = 10**9


@pytest.fixture()
def disks(library_dirs, monkeypatch):
    """Each measured directory reports its own free space (in GB): downloads 111, TV 222."""
    os.makedirs(library_dirs["DOWNLOADS_DIR"], exist_ok=True)
    os.makedirs(library_dirs["TV_DIR"], exist_ok=True)
    free_gb = {library_dirs["DOWNLOADS_DIR"]: 111, library_dirs["TV_DIR"]: 222}

    def disk_usage(path):
        free = free_gb.get(str(path), 999) * GB
        return shutil._ntuple_diskusage(1000 * GB, 1000 * GB - free, free)

    monkeypatch.setattr(shutil, "disk_usage", disk_usage)
    return free_gb


async def _free_gb_everywhere(arr_app) -> tuple[int, int]:
    status = (await arr_app.http.get("/api/status")).json()
    health = (await arr_app.http.get("/api/system/status")).json()
    disk_check = next(h for h in health["health"] if h["id"] == "disk")
    return status["disk"]["free"] // GB, int(disk_check["message"]["params"]["free"])


@pytest.mark.asyncio
async def test_arr_mode_measures_the_downloads_base(arr_app, disks):
    assert await _free_gb_everywhere(arr_app) == (111, 111)


@pytest.mark.asyncio
async def test_standalone_mode_measures_the_tv_library(arr_app, disks):
    (await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})).raise_for_status()

    assert await _free_gb_everywhere(arr_app) == (222, 222)
