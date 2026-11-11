// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// Share-scale regression tests for UptimePoolV2.
//
// The bug these pinned (first deployment, 0xcEb8…F355): a charge lowers `balance` but never
// `totalShares`, so shares-per-wei only ever grew, and `_contribute`'s
// `amount * totalShares / balance` stopped fitting in 256 bits: top-ups reverted MathOverflow
// after 3 to 41 drain/refill cycles. Each scenario below reproduced that revert; each now asserts
// the opposite, plus that the fix (lazy share rescaling, see "Share scale" in the contract) keeps
// every backer's balance exact to the wei.

import { Test } from "forge-std/Test.sol";
import { UptimePoolV2 } from "../src/UptimePoolV2.sol";

contract UptimePoolV2OverflowTest is Test {
    uint256 internal constant ALL = type(uint256).max;
    UptimePoolV2 internal pool;
    address internal admin = address(0xA11CE);
    address internal scheduler = address(0x5CED);
    address internal owner = address(0x0123);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal dust = address(0xD057);
    bytes32 internal constant ID = bytes32(uint256(1));
    uint256 internal sid;

    event SharesReset(bytes32 indexed uptimeId, uint64 epoch);

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePoolV2(admin, 48 hours, scheduler, address(0));
        vm.deal(owner, 1e30);
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(dust, 1e30);
    }

    function _open(uint256 value) internal {
        uint8[] memory roles = new uint8[](1);
        UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](1);
        roles[0] = 1;
        // 1-second period with a huge cap: the allowance never limits these tests.
        terms[0] = UptimePoolV2.Terms(type(uint128).max, 1, 0, 0, 0);
        vm.prank(owner);
        pool.deposit{ value: value }(ID, roles, terms);
    }

    function _charge(uint256 amount) internal returns (uint256) {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = ID;
        amounts[0] = amount;
        vm.prank(scheduler);
        return pool.charge(ids, amounts, ++sid);
    }

    function _topUp(address who, uint256 value) internal {
        vm.prank(who);
        pool.topUp{ value: value }(ID);
    }

    function _bal() internal view returns (uint256 b) {
        (,, b) = pool.getPool(ID);
    }

    function _total() internal view returns (uint256 t) {
        (t,) = pool.getShares(ID);
    }

    /// The books of `who`: nobody is owed more than the pool holds, shares never exceed the total.
    function _assertSolvent(address[] memory who) internal view {
        uint256 sum;
        uint256 shares;
        uint256 holders;
        for (uint256 i; i < who.length; ++i) {
            sum += pool.balanceOf(ID, who[i]);
            uint256 s = pool.sharesOf(ID, who[i]);
            shares += s;
            if (s != 0) holders++;
        }
        uint256 t = _total();
        uint256 b = _bal();
        assertLe(shares, t, "shares exceed total");
        assertLe(sum, b, "owed more than held");
        uint256 slack = t == 0 ? 0 : ((t - shares) * b + t - 1) / t;
        assertLe(b - sum, holders + slack, "more than 1 wei of rounding per backer");
        (uint256 backers,) = pool.getBacking(ID);
        assertEq(backers, holders, "backers count");
    }

    function _three() internal view returns (address[] memory who) {
        who = new address[](3);
        who[0] = owner;
        who[1] = alice;
        who[2] = dust;
    }

    // ------------------------------------------------------------------ the reproductions

    /// Worst case: the pool is charged down to 1 wei (not 0, so no epoch reset) and refilled.
    /// Each cycle multiplies shares-per-wei by 1e18; the 4th 1-GEN top-up used to revert.
    function testWorstCase_DrainToOneWeiAndRefill_NeverBricks() public {
        _open(1 ether);
        for (uint256 i; i < 60; ++i) {
            _charge(_bal() - 1);
            assertEq(_bal(), 1);
            uint256 before = pool.balanceOf(ID, alice);
            _topUp(alice, 1 ether);
            // Alice gets what she put in, to the wei, even on the top-up that rescales.
            assertGe(pool.balanceOf(ID, alice), before + 1 ether - 1);
            assertLe(_total() / _bal(), pool.MAX_SHARES_PER_WEI() << 64);
            _assertSolvent(_three());
        }
        assertGt(pool.shareScale(ID), 40, "the scale advanced about once per cycle");

        // A useful amount from anyone still works (it used to revert for the owner too).
        _topUp(owner, 0.001 ether);
        assertGe(pool.balanceOf(ID, owner), 0.001 ether - 1);

        // Everyone out: the pool is left at exactly 0.
        vm.prank(alice);
        pool.withdraw(ID, ALL);
        vm.prank(owner);
        pool.withdraw(ID, ALL);
        assertEq(_bal(), 0);
        assertEq(address(pool).balance, 0);
        assertEq(_total(), 0);
    }

    /// An early backer who never comes back used to keep the pool bricked forever. Now the pool
    /// keeps working around them, and they stay a backer with a (worthless) non-zero stake.
    function testAbsentBackerNoLongerBricksThePool() public {
        uint256 perRun = 0.0011 ether;
        _open(1 ether);
        _topUp(dust, 1 ether); // an early backer who never comes back
        for (uint256 i; i < 200; ++i) {
            uint256 b = _bal();
            uint256 runs = b / perRun;
            if (b % perRun == 0) runs -= 1;
            _charge(runs * perRun);
            _topUp(alice, 1 ether);
            _assertSolvent(_three());
        }
        assertGt(pool.shareScale(ID), 0);
        assertGt(pool.sharesOf(ID, dust), 0, "a stake is never rounded to zero");
        assertEq(pool.balanceOf(ID, dust), 0, "charged out long ago");

        // The active backers leave with everything they are owed.
        uint256 b0 = _bal();
        vm.prank(owner);
        uint256 a = pool.withdraw(ID, ALL);
        vm.prank(alice);
        a += pool.withdraw(ID, ALL);
        // Dust rule: what the absent backer holds is worth less than 1 wei, so the last active
        // backer takes the whole balance and the epoch resets; nothing is stranded.
        assertEq(a, b0);
        assertEq(_bal(), 0);
        assertEq(_total(), 0);
        assertEq(pool.sharesOf(ID, dust), 0);

        // ...and the pool starts fresh.
        _topUp(owner, 1 ether);
        assertEq(pool.balanceOf(ID, owner), 1 ether);
        assertEq(pool.sharesOf(ID, owner), 1 ether * pool.SCALE());
    }

    /// A charge to exactly 0 still resets the epoch (unchanged behaviour).
    function testChargeToExactlyZeroStillResets() public {
        _open(1 ether);
        for (uint256 i; i < 3; ++i) {
            _charge(_bal() - 1);
            _topUp(alice, 1 ether);
        }
        _charge(_bal());
        assertEq(_total(), 0);
        assertEq(pool.balanceOf(ID, alice), 0);
        _topUp(alice, 1 ether);
        assertEq(pool.balanceOf(ID, alice), 1 ether);
    }

    /// Realistic shape: a fixed per-run charge; the pool runs until a charge no longer fits (a
    /// residual stays), then a backer refills. Returns how many of `cycles` refills succeeded.
    function _cycles(uint256 refill, uint256 perRun, uint256 cycles) internal returns (uint256 done) {
        _open(refill);
        for (; done < cycles; ++done) {
            uint256 b = _bal();
            uint256 runs = b / perRun;
            if (b % perRun == 0) runs -= 1; // keep a residual; an exact 0 would reset the epoch
            _charge(runs * perRun); // one batched charge == `runs` per-run charges for the price
            uint256 before = pool.balanceOf(ID, alice);
            _topUp(alice, refill);
            assertGe(pool.balanceOf(ID, alice), before + refill - 1);
        }
        _assertSolvent(_three());
    }

    /// Used to revert after 6 cycles.
    function testRealistic_1GenRefill_0p0011GenPerRun() public {
        assertEq(_cycles(1 ether, 0.0011 ether, 300), 300);
    }

    /// Used to revert after 5 cycles.
    function testRealistic_10GenRefill_0p0011GenPerRun() public {
        assertEq(_cycles(10 ether, 0.0011 ether, 300), 300);
    }

    /// Heartbeat-like run (about 0.05 GEN per charge). Used to revert after 41 cycles.
    function testRealistic_1GenRefill_0p051GenPerRun() public {
        assertEq(_cycles(1 ether, 0.051 ether, 300), 300);
    }

    /// Topping up BEFORE the pool runs dry (never below 10% of the refill) used to take 137
    /// cycles to brick. 2000 now pass.
    function testKeptAbove10Percent_NeverBricks() public {
        _open(1 ether);
        for (uint256 i; i < 2000; ++i) {
            _charge(0.9 ether);
            _topUp(alice, 0.9 ether);
        }
        assertGt(pool.shareScale(ID), 0);
        _assertSolvent(_three());
    }

    // ------------------------------------------------------------------ rescaling is fair

    /// Two backers who put in the same amount at the same time stay equal (to the wei) through
    /// any number of scale steps, whichever of them touches the pool.
    function testEqualBackersStayEqualAcrossRescales() public {
        _open(1 ether);
        for (uint256 i; i < 30; ++i) {
            if (_bal() < 9) _topUp(owner, 1 ether);
            _charge(_bal() - (i % 7 + 1));
            _topUp(alice, 3 ether);
            _topUp(bob, 3 ether);
            assertApproxEqAbs(pool.balanceOf(ID, alice), pool.balanceOf(ID, bob), 1);
            _charge(1 ether);
            assertApproxEqAbs(pool.balanceOf(ID, alice), pool.balanceOf(ID, bob), 1);
            // Only bob touches the pool here: alice's stake stays several scales behind.
            if (i % 3 == 0) {
                vm.prank(bob);
                pool.withdraw(ID, 0.5 ether);
                _topUp(bob, 0.5 ether);
                assertApproxEqAbs(pool.balanceOf(ID, alice), pool.balanceOf(ID, bob), 2);
                vm.prank(bob);
                pool.withdraw(ID, ALL);
                vm.prank(alice);
                pool.withdraw(ID, ALL);
            }
        }
        assertGt(pool.shareScale(ID), 10);
    }

    /// A scale step moves nobody's balance by more than 1 wei, and a stake that is many steps
    /// behind reads the same before and after its owner touches it.
    function testRescaleMovesNobodyByMoreThanOneWei() public {
        _open(5 ether);
        _topUp(bob, 7 ether);
        for (uint256 i; i < 12; ++i) {
            _charge(_bal() - 1_000_003);
            uint256 ownerBefore = pool.balanceOf(ID, owner);
            uint256 bobBefore = pool.balanceOf(ID, bob);
            _topUp(alice, 2 ether); // rescales on most rounds
            assertApproxEqAbs(pool.balanceOf(ID, owner), ownerBefore, 1);
            assertApproxEqAbs(pool.balanceOf(ID, bob), bobBefore, 1);
            // 5:7, as they came in.
            assertApproxEqAbs(pool.balanceOf(ID, owner) * 7, pool.balanceOf(ID, bob) * 5, 12);
        }
        assertGt(pool.shareScale(ID), 5);
        // Bob's stake was written several scales ago. Touching it changes nothing he is owed.
        uint256 owed = pool.balanceOf(ID, bob);
        vm.prank(bob);
        assertEq(pool.withdraw(ID, ALL), owed);
    }

    // ------------------------------------------------------------------ the dust rule

    /// The last backer with real value takes the whole balance even when stakes worth less than a
    /// wei remain; the epoch resets so those shares cannot dilute the next contribution.
    function testLastRealBackerTakesEverythingAndTheEpochResets() public {
        _open(1 ether);
        _topUp(dust, 1 ether);
        for (uint256 i; i < 4; ++i) {
            _charge(_bal() - 1);
            _topUp(alice, 1 ether);
        }
        _charge(0.25 ether);
        uint256 b = _bal();
        assertEq(pool.balanceOf(ID, alice), b, "alice owns it all: the others hold dust");
        assertEq(pool.balanceOf(ID, owner), 0);
        assertEq(pool.balanceOf(ID, dust), 0);
        (, uint64 epoch) = pool.getShares(ID);
        vm.expectEmit(true, false, false, true);
        emit SharesReset(ID, epoch + 1);
        vm.prank(alice);
        assertEq(pool.withdraw(ID, ALL), b);
        assertEq(_bal(), 0);
        (uint256 backers,) = pool.getBacking(ID);
        assertEq(backers, 0);
        // Dust holders have nothing to take and cannot take anything.
        vm.prank(dust);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.withdraw(ID, ALL);
    }

    /// Owning the whole balance through the dust rule, a backer can also take it in parts.
    function testDustRuleOwnerWithdrawsInParts() public {
        _open(1 ether);
        for (uint256 i; i < 4; ++i) {
            _charge(_bal() - 1);
            _topUp(alice, 1 ether);
        }
        uint256 b = _bal();
        assertEq(pool.balanceOf(ID, alice), b);
        vm.startPrank(alice);
        pool.withdraw(ID, b - 5);
        assertEq(pool.balanceOf(ID, alice), 5);
        pool.withdraw(ID, 4);
        assertEq(pool.balanceOf(ID, alice), 1);
        pool.withdraw(ID, 1);
        vm.stopPrank();
        assertEq(_bal(), 0);
        assertEq(_total(), 0);
    }

    /// The dust rule never takes a wei from anyone: a backer worth 1 wei or more is not dust.
    function testDustRuleDoesNotTouchABackerWorthAWei() public {
        _open(1 ether);
        _topUp(bob, 3); // 3 wei
        assertEq(pool.balanceOf(ID, bob), 3);
        assertEq(pool.balanceOf(ID, owner), 1 ether);
        vm.prank(owner);
        pool.withdraw(ID, ALL);
        assertEq(_bal(), 3);
        assertEq(pool.balanceOf(ID, bob), 3);
        vm.prank(bob);
        pool.withdraw(ID, ALL);
        assertEq(_bal(), 0);
    }

    // ------------------------------------------------------------------ share price floor

    /// The ERC-4626 inflation setup: a pool owner with two wallets grinds shares-per-wei down
    /// (each round one wallet enters and leaves, donating its rounding wei to the other, which
    /// then burns shares to take that wei out) until one share is worth real GEN, so a victim's
    /// contribution rounds down in the attacker's favour. The mint floor stops it: once the price
    /// is below MIN_SHARES_PER_WEI nobody can contribute, so nobody can be short-changed.
    function testInflationGrindIsStoppedByTheMintFloor() public {
        address r = owner; // holds the remainder
        address a = alice; // enters and leaves
        _open(1 ether);
        _charge(0.3 ether); // one run charged: shares-per-wei is no longer a whole number
        uint256 most = pool.balanceOf(ID, r) - 3;
        vm.prank(r);
        pool.withdraw(ID, most);
        bool refused;
        uint256 rounds;
        for (; rounds < 2000 && !refused; ++rounds) {
            // An amount whose shares do not come out whole, so the mint rounds down.
            uint256 odd;
            for (uint256 k = 1; k < 12 && odd == 0; ++k) {
                if (mulmod(k, _total(), _bal()) != 0) odd = k;
            }
            vm.prank(odd == 0 ? r : a);
            try pool.topUp{ value: odd == 0 ? 3 : odd }(ID) { }
            catch (bytes memory err) {
                assertEq(bytes4(err), UptimePoolV2.SharePriceTooLow.selector);
                refused = true;
                break;
            }
            if (odd != 0) {
                vm.prank(a);
                pool.withdraw(ID, ALL); // leaves the rounding wei to r
            } else {
                _charge(1); // a whole-number price rounds nothing: one charged run breaks it
            }
            uint256 owned = pool.balanceOf(ID, r);
            uint256 keep = [uint256(2), 3, 5, 7][rounds % 4];
            if (owned > keep) {
                vm.prank(r);
                pool.withdraw(ID, owned - keep); // burns shares, takes the donated wei back
            }
            // At every step a third party contributing gets what they put in, to the wei.
            uint256 snap = vm.snapshotState();
            vm.prank(bob);
            try pool.topUp{ value: 1 ether + 7 }(ID) {
                assertGe(pool.balanceOf(ID, bob), 1 ether + 6);
            } catch (bytes memory err) {
                assertEq(bytes4(err), UptimePoolV2.SharePriceTooLow.selector);
            }
            vm.revertToState(snap);
        }
        emit log_named_uint("rounds until contributions are refused", rounds);
        emit log_named_uint("shares per wei at that point", _total() / _bal());
        assertTrue(refused, "the grind reached the floor and was refused");
        assertLt(_total() / _bal(), pool.MIN_SHARES_PER_WEI());
        // The attacker only locked their own pool; they can still take their wei out.
        vm.prank(r);
        pool.withdraw(ID, ALL);
        assertEq(_bal(), 0);
        // ...and then it is a fresh pool again.
        _topUp(bob, 1 ether);
        assertEq(pool.balanceOf(ID, bob), 1 ether);
    }

    // ------------------------------------------------------------------ fuzz

    address[] internal fz;
    uint256 internal paidIn;
    uint256 internal paidOut;
    uint256 internal charged;

    function _snapshot() internal view returns (uint256[] memory owed) {
        owed = new uint256[](fz.length);
        for (uint256 i; i < fz.length; ++i) {
            owed[i] = pool.balanceOf(ID, fz[i]);
        }
    }

    function _fzContribute(address actor, uint256 amount) internal {
        uint256[] memory before = _snapshot();
        vm.prank(actor);
        pool.topUp{ value: amount }(ID);
        paidIn += amount;
        for (uint256 i; i < fz.length; ++i) {
            uint256 owed = pool.balanceOf(ID, fz[i]);
            if (fz[i] == actor) assertGe(owed + 1, before[i] + amount, "contributor short-changed");
            else assertApproxEqAbs(owed, before[i], 1, "a contribution moved someone else");
        }
    }

    function _fzWithdraw(address actor, uint256 pick, bool all) internal {
        if (pool.sharesOf(ID, actor) == 0) return;
        uint256[] memory before = _snapshot();
        uint256 owned = pool.balanceOf(ID, actor);
        uint256 amount = all || owned == 0 ? ALL : 1 + pick % owned;
        vm.prank(actor);
        uint256 got = pool.withdraw(ID, amount);
        assertEq(got, amount == ALL ? owned : amount, "withdraw paid something else");
        paidOut += got;
        for (uint256 i; i < fz.length; ++i) {
            if (fz[i] == actor) continue;
            uint256 owed = pool.balanceOf(ID, fz[i]);
            assertGe(owed, before[i], "a withdrawal took from someone else");
            // The leaver's rounding wei goes to those who stay. Whoever is left owning the whole
            // balance also collects the wei their own share was rounded down by: 2 at most.
            assertLe(owed, before[i] + (owed == _bal() ? 2 : 1), "a withdrawal moved someone else");
        }
    }

    /// Random drain/refill/withdraw sequences that push the share scale hard. After every step:
    /// solvent, exact counts, the contributor got what they put in, nobody else moved by more
    /// than a wei. At the end everyone leaves and the pool is empty, with every wei accounted for.
    function testFuzz_DrainRefillWithdraw(uint256 seed) public {
        fz.push(owner);
        fz.push(alice);
        fz.push(bob);
        fz.push(dust);
        _open(1 ether);
        paidIn = 1 ether;
        for (uint256 step; step < 48; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 kind = seed % 10;
            address actor = fz[(seed >> 8) % 4];
            uint256 b = _bal();
            if (kind < 3) {
                if (b < 2) continue;
                // drain to a residual: usually a few wei, sometimes anything
                uint256 residue = (seed >> 16) % 3 == 0 ? 1 + (seed >> 24) % (b - 1) : 1 + (seed >> 24) % 1000;
                if (residue >= b) residue = b - 1;
                charged += _charge(b - residue);
            } else if (kind < 7) {
                // contribute between 1 wei and 1e24 wei, log-uniform
                _fzContribute(actor, 1 + (seed >> 24) % (10 ** ((seed >> 16) % 25)));
            } else {
                _fzWithdraw(actor, seed >> 24, kind == 9);
            }
            _assertSolvent(fz);
            assertEq(_bal() == 0, _total() == 0, "balance and shares are zero together");
        }
        for (uint256 i; i < 4; ++i) {
            if (pool.sharesOf(ID, fz[i]) != 0) {
                vm.prank(fz[i]);
                paidOut += pool.withdraw(ID, ALL);
            }
        }
        assertEq(_bal(), 0, "everyone left, the pool is empty");
        assertEq(address(pool).balance, 0);
        assertEq(paidIn, paidOut + charged, "every wei accounted for");
    }

    /// One contribution after an arbitrary drain: no revert for any amount or residual a real
    /// chain can hold, and the contributor gets it back to the wei.
    function testFuzz_ContributeAfterAnyDrainNeverReverts(
        uint96 first,
        uint96 residual,
        uint96 amount,
        uint8 cycles
    ) public {
        uint256 f = bound(first, 2, 1e27);
        _open(f);
        uint256 n = bound(cycles, 1, 12);
        for (uint256 i; i < n; ++i) {
            uint256 b = _bal();
            uint256 residue = bound(residual, 1, b - 1);
            _charge(b - residue);
            uint256 a = bound(amount, 1, 1e27);
            uint256 before = pool.balanceOf(ID, alice);
            _topUp(alice, a);
            assertGe(pool.balanceOf(ID, alice) + 1, before + a);
            assertLe(pool.balanceOf(ID, alice) + pool.balanceOf(ID, owner), _bal());
        }
    }
}
