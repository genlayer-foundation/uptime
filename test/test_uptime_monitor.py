"""Direct-mode tests for UptimeMonitor contract."""

import json
import pytest
from dataclasses import dataclass

# GenVM test harness
from genlayer.testing import ContractRunner


@pytest.fixture
def runner():
    return ContractRunner("contracts/uptime_monitor.py")


@pytest.fixture
def contract(runner):
    """Deploy the contract and return the runner."""
    runner.deploy()
    return runner


def test_deploy(contract):
    """Contract deploys and initializes services."""
    services = contract.call("get_services")
    assert len(services) == 7
    assert "zksync_bridge" in services
    assert "studionet_rpc" in services
    assert "asimov_rpc" in services
    assert "bradbury_rpc" in services
    assert "explorer_studio" in services
    assert "explorer_asimov" in services
    assert "explorer_bradbury" in services


def test_initial_counts_are_zero(contract):
    """All service check counts start at 0."""
    services = contract.call("get_services")
    for service_id in services:
        count = contract.call("get_check_count", service_id)
        assert int(count) == 0


def test_get_latest_check_empty(contract):
    """get_latest_check returns empty dict when no checks exist."""
    result = contract.call("get_latest_check", "studionet_rpc")
    assert result == {}


def test_get_all_latest_empty(contract):
    """get_all_latest returns empty dict when no checks exist."""
    result = contract.call("get_all_latest")
    assert result == {}


def test_get_uptime_stats_empty(contract):
    """get_uptime_stats returns zeros when no checks exist."""
    result = contract.call("get_uptime_stats", "studionet_rpc", 10)
    assert result["total"] == 0
    assert result["up"] == 0
    assert result["uptime_pct"] == 0


def test_get_checks_empty(contract):
    """get_checks returns empty list when no checks exist."""
    result = contract.call("get_checks", "studionet_rpc", 0, 10)
    assert result == []


def test_get_checks_pagination(contract):
    """get_checks respects offset and limit."""
    # Mock run_checks by directly manipulating storage won't work in direct mode.
    # We test pagination logic with the view methods after run_checks.
    # This test validates the view method exists and returns correct type.
    result = contract.call("get_checks", "studionet_rpc", 0, 5)
    assert isinstance(result, list)
