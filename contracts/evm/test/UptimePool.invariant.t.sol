// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Test } from "forge-std/Test.sol";
import { UptimePool } from "../src/UptimePool.sol";

/// Random owners, spenders and an attacker drive the pool; the invariants check the books.
contract PoolHandler is Test {
    UptimePool public pool;
    address public scheduler;
    address[3] public owners;
    bytes32[3] public ids;
    address public attacker = makeAddr("attacker");
    uint256 public sid;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public charged;
    // per pool: what the scheduler drew in the current day window
    mapping(uint256 => uint256) public windowOf;
    mapping(uint256 => uint256) public drawnInWindow;
    uint256 public maxDrawnInWindow;
    bool public breached;

    constructor(UptimePool pool_, address scheduler_) {
        pool = pool_;
        scheduler = scheduler_;
        for (uint256 i; i < 3; ++i) {
            owners[i] = makeAddr(string(abi.encodePacked("owner", i)));
            ids[i] = keccak256(abi.encodePacked("pool", i));
            vm.deal(owners[i], 1_000 ether);
            uint8[] memory roles = new uint8[](1);
            UptimePool.Terms[] memory terms = new UptimePool.Terms[](1);
            roles[0] = 1;
            terms[0] = UptimePool.Terms(1 ether, 1 days, 0, 0, 0.25 ether);
            vm.prank(owners[i]);
            pool.deposit{ value: 10 ether }(ids[i], roles, terms);
            deposited += 10 ether;
        }
    }

    function topUp(uint256 who, uint96 amount) external {
        who %= 3;
        amount = uint96(bound(amount, 1, 5 ether));
        vm.prank(owners[who]);
        pool.topUp{ value: amount }(ids[who]);
        deposited += amount;
    }

    function withdraw(uint256 who, uint96 amount) external {
        who %= 3;
        (,, uint256 bal) = pool.getPool(ids[who]);
        if (bal == 0) return;
        amount = uint96(bound(amount, 1, bal));
        vm.prank(owners[who]);
        pool.withdraw(ids[who], amount);
        withdrawn += amount;
    }

    function pause(uint256 who, bool p) external {
        who %= 3;
        vm.prank(owners[who]);
        pool.setPaused(ids[who], p);
    }

    function charge(uint256 who, uint96 amount) external {
        who %= 3;
        amount = uint96(bound(amount, 0, 0.5 ether));
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[who];
        a[0] = amount;
        vm.prank(scheduler);
        uint256 paid = pool.charge(l, a, ++sid);
        charged += paid;
        (UptimePool.Terms memory t,,,,) = pool.getAllowance(ids[who], 1);
        uint256 w = (block.timestamp - t.startDate) / 1 days;
        if (w != windowOf[who]) {
            windowOf[who] = w;
            drawnInWindow[who] = 0;
        }
        drawnInWindow[who] += paid;
        if (drawnInWindow[who] > maxDrawnInWindow) maxDrawnInWindow = drawnInWindow[who];
    }

    function attackerTries(uint256 who, uint96 amount) external {
        who %= 3;
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[who];
        a[0] = amount;
        vm.startPrank(attacker);
        try pool.withdraw(ids[who], amount) { breached = true; } catch { }
        try pool.charge(l, a, type(uint256).max) { breached = true; } catch { }
        try pool.setPaused(ids[who], true) { breached = true; } catch { }
        vm.stopPrank();
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + (dt % 2 days));
    }

    function sumBalances() external view returns (uint256 s) {
        for (uint256 i; i < 3; ++i) {
            (,, uint256 b) = pool.getPool(ids[i]);
            s += b;
        }
    }
}

contract UptimePoolInvariantTest is Test {
    UptimePool internal pool;
    PoolHandler internal handler;
    address internal scheduler = makeAddr("scheduler");

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePool(makeAddr("admin"), 48 hours, scheduler, makeAddr("mailer"));
        handler = new PoolHandler(pool, scheduler);
        targetContract(address(handler));
    }

    function invariant_totalEqualsSumOfPools() public view {
        assertEq(pool.totalBalance(), handler.sumBalances());
    }

    function invariant_contractHoldsEveryLiability() public view {
        assertGe(address(pool).balance, pool.totalBalance());
    }

    function invariant_conservation() public view {
        assertEq(handler.deposited(), handler.withdrawn() + handler.charged() + pool.totalBalance());
        assertEq(scheduler.balance, handler.charged());
    }

    function invariant_attackerNeverSucceeds() public view {
        assertFalse(handler.breached());
    }

    function invariant_neverMoreThanOnePeriodPerWindow() public view {
        assertLe(handler.maxDrawnInWindow(), 1 ether);
    }
}
