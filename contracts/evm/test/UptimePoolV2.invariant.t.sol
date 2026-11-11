// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Test } from "forge-std/Test.sol";
import { UptimePoolV2 } from "../src/UptimePoolV2.sol";

/// Random backers contribute to, withdraw from and get charged across three pools.
/// `stress` lifts the allowance caps and adds drains to a few wei and wei-sized contributions, so
/// runs cross the share-scale threshold (rescales) and exercise the dust rule.
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
    bool public stress;
    /// A contribution paid in more than it credited, or moved someone else by more than a wei.
    bool public unfair;
    uint256 public rescales;

    constructor(UptimePoolV2 pool_, address scheduler_, bool stress_) {
        pool = pool_;
        scheduler = scheduler_;
        stress = stress_;
        for (uint256 i; i < 5; ++i) {
            backers[i] = makeAddr(string(abi.encodePacked("backer", i)));
            vm.deal(backers[i], 1_000_000 ether);
        }
        for (uint256 i; i < 3; ++i) {
            ids[i] = keccak256(abi.encodePacked("pool", i));
            uint8[] memory roles = new uint8[](1);
            UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](1);
            roles[0] = 1;
            terms[0] = stress_
                ? UptimePoolV2.Terms(type(uint128).max, 1, 0, 0, 0)
                : UptimePoolV2.Terms(50 ether, 1 days, 0, 0, 5 ether);
            vm.prank(backers[i]);
            pool.deposit{ value: 10 ether }(ids[i], roles, terms);
            deposited += 10 ether;
        }
    }

    function contribute(uint256 who, uint256 p, uint96 amount) external {
        who %= 5;
        p %= 3;
        _contribute(who, p, bound(amount, 1, 20 ether));
    }

    /// Wei-sized contributions: they land on drained pools and on dust.
    function contributeWei(uint256 who, uint256 p, uint16 amount) external {
        _contribute(who % 5, p % 3, bound(amount, 1, 5000));
    }

    function _contribute(uint256 who, uint256 p, uint256 amount) internal {
        uint256[5] memory before = _owed(p);
        uint64 scale = pool.shareScale(ids[p]);
        vm.prank(backers[who]);
        pool.topUp{ value: amount }(ids[p]);
        deposited += amount;
        rescales += pool.shareScale(ids[p]) - scale;
        for (uint256 i; i < 5; ++i) {
            uint256 owed = pool.balanceOf(ids[p], backers[i]);
            if (i == who ? owed + 1 < before[i] + amount : (owed > before[i] + 1 || owed + 1 < before[i])) {
                unfair = true;
            }
        }
    }

    function _owed(uint256 p) internal view returns (uint256[5] memory owed) {
        for (uint256 i; i < 5; ++i) {
            owed[i] = pool.balanceOf(ids[p], backers[i]);
        }
    }

    /// A withdrawal never lowers anyone else, and raises them by a rounding wei at most (2 for
    /// whoever is left owning the whole balance).
    function _checkOthers(uint256 who, uint256 p, uint256[5] memory before) internal {
        (,, uint256 b) = pool.getPool(ids[p]);
        for (uint256 i; i < 5; ++i) {
            if (i == who) continue;
            uint256 owed = pool.balanceOf(ids[p], backers[i]);
            if (owed < before[i] || owed > before[i] + (owed == b ? 2 : 1)) unfair = true;
        }
    }

    function withdraw(uint256 who, uint256 p, uint96 amount) external {
        who %= 5;
        p %= 3;
        uint256 b = pool.balanceOf(ids[p], backers[who]);
        if (b == 0) return;
        amount = uint96(bound(amount, 1, b));
        uint256[5] memory before = _owed(p);
        vm.prank(backers[who]);
        uint256 got = pool.withdraw(ids[p], amount);
        withdrawn += got;
        if (got != amount) unfair = true;
        _checkOthers(who, p, before);
    }

    function withdrawAll(uint256 who, uint256 p) external {
        who %= 5;
        p %= 3;
        if (pool.sharesOf(ids[p], backers[who]) == 0) return;
        uint256[5] memory before = _owed(p);
        vm.prank(backers[who]);
        uint256 got = pool.withdraw(ids[p], ALL_);
        withdrawn += got;
        if (got != before[who]) unfair = true; // balanceOf is exactly what ALL pays
        _checkOthers(who, p, before);
    }

    /// Charge the pool down to a few wei (never 0, so the epoch does not reset): each of these
    /// multiplies shares-per-wei by up to 1e19. Only lands under `stress` (no line cap).
    function drain(uint256 p, uint16 residue) external {
        p %= 3;
        (,, uint256 b) = pool.getPool(ids[p]);
        if (b < 2) return;
        uint256 keep = bound(residue, 1, b - 1 < 2000 ? b - 1 : 2000);
        bytes32[] memory l = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        l[0] = ids[p];
        a[0] = b - keep;
        vm.prank(scheduler);
        charged += pool.charge(l, a, ++sid);
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

    /// (sum of backers' balances, number of backers holding shares, sum of their shares) for `p`.
    function books(uint256 p) public view returns (uint256 sum, uint256 holders, uint256 shares) {
        for (uint256 i; i < 5; ++i) {
            sum += pool.balanceOf(ids[p], backers[i]);
            uint256 s = pool.sharesOf(ids[p], backers[i]);
            shares += s;
            if (s > 0) holders++;
        }
    }
}

contract UptimePoolV2InvariantTest is Test {
    uint256 internal constant ALL_ = type(uint256).max;
    UptimePoolV2 internal pool;
    PoolV2Handler internal handler;
    address internal scheduler = makeAddr("scheduler");

    function _stress() internal pure virtual returns (bool) {
        return false;
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePoolV2(makeAddr("admin"), 48 hours, scheduler, makeAddr("mailer"));
        handler = new PoolV2Handler(pool, scheduler, _stress());
        targetContract(address(handler));
    }

    function invariant_backersNeverOwedMoreThanThePool() public view {
        for (uint256 p; p < 3; ++p) {
            (uint256 sum, uint256 holders, uint256 shares) = handler.books(p);
            (,, uint256 b) = pool.getPool(handler.ids(p));
            (uint256 total,) = pool.getShares(handler.ids(p));
            assertLe(shares, total); // stakes never add up to more than the total
            assertLe(sum, b); // solvent
            // < 1 wei of rounding per backer, plus whatever the unowned shares a scale step leaves
            // (total - shares) are worth: 0 until a pool has rescaled, a fraction of a wei after.
            uint256 slack = total == 0 ? 0 : ((total - shares) * b + total - 1) / total;
            assertLe(b - sum, holders + slack);
            (uint256 backers,) = pool.getBacking(handler.ids(p));
            assertEq(backers, holders);
            if (holders == 0) assertEq(b, 0); // nothing stranded behind zero shares
            assertEq(b == 0, total == 0); // a balance always has shares behind it, and vice versa
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

    /// Every contribution credited what was paid (to the wei), every withdrawal paid what
    /// balanceOf said, and neither moved another backer by more than a rounding wei.
    function invariant_exactAndFair() public view {
        assertFalse(handler.unfair());
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
            (uint256 total,) = pool.getShares(id);
            assertEq(total, 0);
        }
        assertEq(pool.totalBalance(), 0);
        assertEq(address(pool).balance, 0);
    }
}

/// The same invariants with the caps lifted: pools are drained to a few wei and refilled over and
/// over, so the share scale advances many times per run.
contract UptimePoolV2StressInvariantTest is UptimePoolV2InvariantTest {
    function _stress() internal pure override returns (bool) {
        return true;
    }

    /// Not vacuous: over one long sequence the scale really does advance.
    function testStressSequenceRescales() public {
        for (uint256 i; i < 40; ++i) {
            handler.drain(i, uint16(i * 37 + 1));
            handler.contribute(i, i, uint96(1 ether + i));
            handler.contributeWei(i + 1, i, uint16(i + 1));
            handler.withdraw(i + 2, i, uint96(i * 1e15 + 1));
        }
        assertGt(handler.rescales(), 10);
        invariant_backersNeverOwedMoreThanThePool();
        invariant_conservation();
        invariant_exactAndFair();
        afterInvariant();
    }
}
