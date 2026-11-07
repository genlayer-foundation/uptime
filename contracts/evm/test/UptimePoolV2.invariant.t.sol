// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Test } from "forge-std/Test.sol";
import { UptimePoolV2 } from "../src/UptimePoolV2.sol";

/// Random backers contribute to, withdraw from and get charged across three pools.
contract PoolV2Handler is Test {
    uint256 internal constant ALL_ = type(uint256).max;
    UptimePoolV2 public pool;
    address public scheduler;
    address[5] public backers;
    bytes32[3] public ids;
    uint256 public sid;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public charged;
    bool public breached;

    constructor(UptimePoolV2 pool_, address scheduler_) {
        pool = pool_;
        scheduler = scheduler_;
        for (uint256 i; i < 5; ++i) {
            backers[i] = makeAddr(string(abi.encodePacked("backer", i)));
            vm.deal(backers[i], 1_000_000 ether);
        }
        for (uint256 i; i < 3; ++i) {
            ids[i] = keccak256(abi.encodePacked("pool", i));
            uint8[] memory roles = new uint8[](1);
            UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](1);
            roles[0] = 1;
            terms[0] = UptimePoolV2.Terms(50 ether, 1 days, 0, 0, 5 ether);
            vm.prank(backers[i]);
            pool.deposit{ value: 10 ether }(ids[i], roles, terms);
            deposited += 10 ether;
        }
    }

    function contribute(uint256 who, uint256 p, uint96 amount) external {
        who %= 5;
        p %= 3;
        amount = uint96(bound(amount, 1, 20 ether));
        vm.prank(backers[who]);
        pool.topUp{ value: amount }(ids[p]);
        deposited += amount;
    }

    function withdraw(uint256 who, uint256 p, uint96 amount) external {
        who %= 5;
        p %= 3;
        uint256 b = pool.balanceOf(ids[p], backers[who]);
        if (b == 0) return;
        amount = uint96(bound(amount, 1, b));
        vm.prank(backers[who]);
        withdrawn += pool.withdraw(ids[p], amount);
    }

    function withdrawAll(uint256 who, uint256 p) external {
        who %= 5;
        p %= 3;
        if (pool.sharesOf(ids[p], backers[who]) == 0) return;
        vm.prank(backers[who]);
        withdrawn += pool.withdraw(ids[p], ALL_);
    }

    function charge(uint256 p, uint96 amount) external {
        p %= 3;
        amount = uint96(bound(amount, 0, 6 ether));
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[p];
        a[0] = amount;
        vm.prank(scheduler);
        charged += pool.charge(l, a, ++sid);
    }

    function chargeAll(uint256 p) external {
        p %= 3;
        (,, uint256 b) = pool.getPool(ids[p]);
        if (b == 0 || b > 5 ether) return;
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[p];
        a[0] = b;
        vm.prank(scheduler);
        charged += pool.charge(l, a, ++sid);
    }

    /// A backer tries to take more than their share, or to act as owner/spender.
    function overreach(uint256 who, uint256 p) external {
        who %= 5;
        p %= 3;
        uint256 b = pool.balanceOf(ids[p], backers[who]);
        vm.startPrank(backers[who]);
        try pool.withdraw(ids[p], b + 1) {
            breached = true;
        } catch { }
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[p];
        a[0] = 1;
        try pool.charge(l, a, type(uint256).max) {
            breached = true;
        } catch { }
        if (who != p) {
            try pool.setPaused(ids[p], true) {
                breached = true;
            } catch { }
        }
        vm.stopPrank();
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + (dt % 2 days));
    }

    function sumPools() external view returns (uint256 s) {
        for (uint256 i; i < 3; ++i) {
            (,, uint256 b) = pool.getPool(ids[i]);
            s += b;
        }
    }

    /// (sum of backers' balances, number of backers holding shares) for pool `p`.
    function books(uint256 p) public view returns (uint256 sum, uint256 holders) {
        for (uint256 i; i < 5; ++i) {
            sum += pool.balanceOf(ids[p], backers[i]);
            if (pool.sharesOf(ids[p], backers[i]) > 0) holders++;
        }
    }
}

contract UptimePoolV2InvariantTest is Test {
    uint256 internal constant ALL_ = type(uint256).max;
    UptimePoolV2 internal pool;
    PoolV2Handler internal handler;
    address internal scheduler = makeAddr("scheduler");

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePoolV2(makeAddr("admin"), 48 hours, scheduler, makeAddr("mailer"));
        handler = new PoolV2Handler(pool, scheduler);
        targetContract(address(handler));
    }

    function invariant_backersNeverOwedMoreThanThePool() public view {
        for (uint256 p; p < 3; ++p) {
            (uint256 sum, uint256 holders) = handler.books(p);
            (,, uint256 b) = pool.getPool(handler.ids(p));
            assertLe(sum, b);
            assertLe(b - sum, holders); // < 1 wei of rounding per backer
            (uint256 backers,) = pool.getBacking(handler.ids(p));
            assertEq(backers, holders);
            if (holders == 0) assertEq(b, 0); // nothing stranded behind zero shares
        }
    }

    function invariant_totalEqualsSumOfPoolsEqualsHeld() public view {
        assertEq(pool.totalBalance(), handler.sumPools());
        assertEq(pool.totalBalance(), address(pool).balance);
    }

    function invariant_conservation() public view {
        assertEq(handler.deposited(), handler.withdrawn() + handler.charged() + pool.totalBalance());
        assertEq(scheduler.balance, handler.charged());
    }

    function invariant_noOverreach() public view {
        assertFalse(handler.breached());
    }

    /// After every run: every backer leaving empties every pool exactly.
    function afterInvariant() public {
        for (uint256 p; p < 3; ++p) {
            bytes32 id = handler.ids(p);
            for (uint256 i; i < 5; ++i) {
                address w = handler.backers(i);
                if (pool.sharesOf(id, w) > 0) {
                    vm.prank(w);
                    pool.withdraw(id, ALL_);
                }
            }
            (,, uint256 b) = pool.getPool(id);
            assertEq(b, 0);
        }
        assertEq(pool.totalBalance(), 0);
        assertEq(address(pool).balance, 0);
    }
}
