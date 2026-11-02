// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Test } from "forge-std/Test.sol";
import { UptimePool } from "../src/UptimePool.sol";

/// Owner contract whose receive() tries to re-enter the pool.
contract ReentrantOwner {
    UptimePool internal pool;
    bytes32 internal id;
    uint8 public mode; // 1 = re-withdraw, 2 = topUp, 3 = setPaused
    bool public reentered;

    constructor(UptimePool pool_) {
        pool = pool_;
    }

    function open(bytes32 id_) external payable {
        id = id_;
        pool.deposit{ value: msg.value }(id_, new uint8[](0), new UptimePool.Terms[](0));
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function pull(uint256 amount) external {
        pool.withdraw(id, amount);
    }

    receive() external payable {
        reentered = true;
        if (mode == 1) pool.withdraw(id, 1);
        else if (mode == 2) pool.topUp{ value: 1 }(id);
        else if (mode == 3) pool.setPaused(id, true);
    }
}

/// Spender contract whose receive() tries to charge again.
contract ReentrantSpender {
    UptimePool public pool;
    bytes32 internal id;
    uint256 internal amount;

    function setPool(UptimePool pool_, bytes32 id_, uint256 amount_) external {
        pool = pool_;
        id = id_;
        amount = amount_;
    }

    function run(uint256 settlementId) external returns (uint256) {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        return pool.charge(ids, amounts, settlementId);
    }

    receive() external payable {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        pool.charge(ids, amounts, type(uint256).max);
    }
}

/// Contract that refuses native value.
contract Refuser {
    UptimePool internal pool;

    constructor(UptimePool pool_) {
        pool = pool_;
    }

    function open(bytes32 id) external payable {
        pool.deposit{ value: msg.value }(id, new uint8[](0), new UptimePool.Terms[](0));
    }

    function pull(bytes32 id, uint256 amount) external {
        pool.withdraw(id, amount);
    }
}

contract UptimePoolTest is Test {
    UptimePool internal pool;
    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal mailer = makeAddr("mailer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant ID = keccak256("uptime-1");
    bytes32 internal constant ID2 = keccak256("uptime-2");
    uint8 internal constant SCHED = 1;
    uint8 internal constant MAIL = 2;

    event ChargeSkipped(
        bytes32 indexed uptimeId,
        uint8 indexed role,
        uint256 indexed settlementId,
        uint256 amount,
        UptimePool.SkipReason reason
    );
    event Charged(bytes32 indexed uptimeId, uint8 indexed role, uint256 indexed settlementId, uint256 amount);

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePool(admin, 48 hours, scheduler, mailer);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    // ------------------------------------------------------------ helpers

    function _terms(uint128 perDay, uint128 perLine) internal pure returns (UptimePool.Terms memory) {
        return UptimePool.Terms({
            periodAmount: perDay, periodDuration: 1 days, startDate: 0, expiry: 0, maxPerCharge: perLine
        });
    }

    function _open(address who, bytes32 id, uint256 value, uint128 schedDay, uint128 schedLine) internal {
        uint8[] memory roles = new uint8[](2);
        UptimePool.Terms[] memory terms = new UptimePool.Terms[](2);
        roles[0] = SCHED;
        terms[0] = _terms(schedDay, schedLine);
        roles[1] = MAIL;
        terms[1] = _terms(1 ether, 0.1 ether);
        vm.prank(who);
        pool.deposit{ value: value }(id, roles, terms);
    }

    function _charge(address spender, bytes32 id, uint256 amount, uint256 sid) internal returns (uint256) {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        vm.prank(spender);
        return pool.charge(ids, amounts, sid);
    }

    function _balance(bytes32 id) internal view returns (uint256 b) {
        (,, b) = pool.getPool(id);
    }

    // ------------------------------------------------------------ deposit / topUp

    function testDepositCreatesPoolWithAllowances() public {
        _open(alice, ID, 10 ether, 2 ether, 0.05 ether);
        (address owner, bool paused, uint256 bal) = pool.getPool(ID);
        assertEq(owner, alice);
        assertFalse(paused);
        assertEq(bal, 10 ether);
        assertEq(pool.totalBalance(), 10 ether);
        assertEq(address(pool).balance, 10 ether);
        (UptimePool.Terms memory t,,,, bool active) = pool.getAllowance(ID, SCHED);
        assertTrue(active);
        assertEq(t.periodAmount, 2 ether);
        assertEq(t.maxPerCharge, 0.05 ether);
        assertEq(t.startDate, block.timestamp, "startDate 0 means now");
    }

    function testDepositRejectsTakenIdZeroValueZeroIdAndBadTerms() public {
        _open(alice, ID, 1 ether, 1 ether, 0);
        vm.prank(bob);
        vm.expectRevert(UptimePool.PoolExists.selector);
        pool.deposit{ value: 1 ether }(ID, new uint8[](0), new UptimePool.Terms[](0));

        vm.prank(bob);
        vm.expectRevert(UptimePool.ZeroAmount.selector);
        pool.deposit(ID2, new uint8[](0), new UptimePool.Terms[](0));

        vm.prank(bob);
        vm.expectRevert(UptimePool.InvalidUptimeId.selector);
        pool.deposit{ value: 1 }(bytes32(0), new uint8[](0), new UptimePool.Terms[](0));

        uint8[] memory roles = new uint8[](1);
        UptimePool.Terms[] memory terms = new UptimePool.Terms[](1);
        roles[0] = SCHED;
        terms[0] = _terms(0, 0);
        vm.prank(bob);
        vm.expectRevert(UptimePool.InvalidTerms.selector);
        pool.deposit{ value: 1 }(ID2, roles, terms);

        roles[0] = 0;
        terms[0] = _terms(1, 0);
        vm.prank(bob);
        vm.expectRevert(UptimePool.InvalidRole.selector);
        pool.deposit{ value: 1 }(ID2, roles, terms);

        vm.prank(bob);
        vm.expectRevert(UptimePool.LengthMismatch.selector);
        pool.deposit{ value: 1 }(ID2, roles, new UptimePool.Terms[](0));
    }

    function testTopUpIsOwnerOnly() public {
        _open(alice, ID, 1 ether, 1 ether, 0);
        vm.prank(alice);
        pool.topUp{ value: 2 ether }(ID);
        assertEq(_balance(ID), 3 ether);

        vm.prank(bob);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.topUp{ value: 1 ether }(ID);

        vm.prank(bob);
        vm.expectRevert(UptimePool.UnknownPool.selector);
        pool.topUp{ value: 1 ether }(ID2);
    }

    function testPlainTransfersAreRejected() public {
        vm.prank(alice);
        (bool ok,) = address(pool).call{ value: 1 ether }("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------ withdraw

    function testWithdrawIsImmediateAndPartial() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        pool.withdraw(ID, 4 ether);
        assertEq(alice.balance, before + 4 ether);
        assertEq(_balance(ID), 6 ether);
        assertEq(pool.totalBalance(), 6 ether);
    }

    function testWithdrawAllWhilePausedAndAfterCharges() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        _charge(scheduler, ID, 0.3 ether, 1);
        vm.prank(alice);
        pool.setPaused(ID, true);
        uint256 before = alice.balance;
        uint256 all = pool.ALL();
        vm.prank(alice);
        uint256 out = pool.withdraw(ID, all);
        assertEq(out, 9.7 ether);
        assertEq(alice.balance, before + 9.7 ether);
        assertEq(_balance(ID), 0);
        assertEq(address(pool).balance, 0);
    }

    function testWithdrawToRecipient() public {
        _open(alice, ID, 5 ether, 1 ether, 0);
        uint256 before = bob.balance;
        vm.prank(alice);
        pool.withdrawTo(ID, 2 ether, payable(bob));
        assertEq(bob.balance, before + 2 ether);

        vm.prank(alice);
        vm.expectRevert(UptimePool.InvalidRecipient.selector);
        pool.withdrawTo(ID, 1, payable(address(0)));
    }

    function testNonOwnerCannotWithdraw() public {
        _open(alice, ID, 5 ether, 1 ether, 0);
        vm.prank(bob);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.withdraw(ID, 1 ether);
        vm.prank(bob);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.withdrawTo(ID, 1 ether, payable(bob));
        // Neither spenders nor the admin hold any power over balances.
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.withdraw(ID, 1 ether);
        vm.prank(admin);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.withdraw(ID, 1 ether);
        assertEq(_balance(ID), 5 ether);
    }

    function testWithdrawOverBalanceAndZeroRevert() public {
        _open(alice, ID, 1 ether, 1 ether, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.InsufficientBalance.selector, 1 ether, 2 ether));
        pool.withdraw(ID, 2 ether);
        vm.prank(alice);
        vm.expectRevert(UptimePool.ZeroAmount.selector);
        pool.withdraw(ID, 0);
    }

    function testRejectedTransferRevertsAndKeepsBalance() public {
        Refuser r = new Refuser(pool);
        r.open{ value: 1 ether }(ID);
        vm.expectRevert(UptimePool.NativeTransferFailed.selector);
        r.pull(ID, 1 ether);
        assertEq(_balance(ID), 1 ether);
        assertEq(pool.totalBalance(), 1 ether);
    }

    // ------------------------------------------------------------ charge

    function testChargePaysSpenderWithinCaps() public {
        _open(alice, ID, 10 ether, 1 ether, 0.1 ether);
        uint256 before = scheduler.balance;
        uint256 paid = _charge(scheduler, ID, 0.1 ether, 1);
        assertEq(paid, 0.1 ether);
        assertEq(scheduler.balance, before + 0.1 ether);
        assertEq(_balance(ID), 9.9 ether);
        assertEq(pool.lastSettlement(SCHED), 1);
        assertEq(pool.available(ID, SCHED), 0.1 ether, "line cap bounds what is shown");
    }

    function testBatchLinesAreRunsAndRepeatIds() public {
        _open(alice, ID, 10 ether, 1 ether, 0.1 ether);
        _open(bob, ID2, 10 ether, 1 ether, 0.1 ether);
        bytes32[] memory ids = new bytes32[](3);
        uint256[] memory amounts = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (ID, ID, ID2);
        (amounts[0], amounts[1], amounts[2]) = (0.1 ether, 0.05 ether, 0.02 ether);
        vm.prank(scheduler);
        uint256 paid = pool.charge(ids, amounts, 7);
        assertEq(paid, 0.17 ether);
        assertEq(_balance(ID), 9.85 ether);
        assertEq(_balance(ID2), 9.98 ether);
        (, uint256 spent,,,) = pool.getAllowance(ID, SCHED);
        assertEq(spent, 0.15 ether);
    }

    function testNonSpenderCannotCharge() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        for (uint256 i; i < 3; ++i) {
            address who = i == 0 ? alice : i == 1 ? bob : admin;
            bytes32[] memory ids = new bytes32[](1);
            uint256[] memory amounts = new uint256[](1);
            ids[0] = ID;
            amounts[0] = 1;
            vm.prank(who);
            vm.expectRevert(UptimePool.NotSpender.selector);
            pool.charge(ids, amounts, 1);
        }
    }

    function testReplayedSettlementReverts() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        _charge(scheduler, ID, 0.1 ether, 5);
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = ID;
        amounts[0] = 0.1 ether;
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.SettlementReplayed.selector, 5, 5));
        pool.charge(ids, amounts, 5);
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.SettlementReplayed.selector, 5, 4));
        pool.charge(ids, amounts, 4);
        // Sequences are per role: the mailer's id 1 is unaffected.
        _charge(mailer, ID, 0.01 ether, 1);
        assertEq(_balance(ID), 10 ether - 0.11 ether);
    }

    function testSkippedLineStillConsumesSettlementId() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        vm.prank(alice);
        pool.setPaused(ID, true);
        assertEq(_charge(scheduler, ID, 0.1 ether, 3), 0);
        assertEq(pool.lastSettlement(SCHED), 3);
    }

    function testOverLineCapIsSkipped() public {
        _open(alice, ID, 10 ether, 1 ether, 0.1 ether);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 1, 0.2 ether, UptimePool.SkipReason.OverLineCap);
        assertEq(_charge(scheduler, ID, 0.2 ether, 1), 0);
        assertEq(_balance(ID), 10 ether);
    }

    function testOverPeriodCapIsSkippedAndResetsNextPeriodWithoutCarryOver() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        assertEq(_charge(scheduler, ID, 0.7 ether, 1), 0.7 ether);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 2, 0.4 ether, UptimePool.SkipReason.OverPeriodCap);
        assertEq(_charge(scheduler, ID, 0.4 ether, 2), 0);
        assertEq(_charge(scheduler, ID, 0.3 ether, 3), 0.3 ether, "exactly the remainder is fine");
        assertEq(pool.available(ID, SCHED), 0);

        vm.warp(block.timestamp + 1 days);
        assertEq(pool.available(ID, SCHED), 1 ether);
        assertEq(_charge(scheduler, ID, 1 ether, 4), 1 ether);

        // Skip two whole periods unused: still only one period's amount, no carry-over.
        vm.warp(block.timestamp + 3 days);
        assertEq(pool.available(ID, SCHED), 1 ether);
        assertEq(_charge(scheduler, ID, 1.5 ether, 5), 0);
    }

    function testPeriodsAreFixedWindowsFromStartDate() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        vm.warp(block.timestamp + 1 days - 1);
        assertEq(_charge(scheduler, ID, 1 ether, 1), 1 ether);
        vm.warp(block.timestamp + 1);
        assertEq(_charge(scheduler, ID, 1 ether, 2), 1 ether, "new window one second later");
    }

    function testPausedPoolIsSkippedForEverySpender() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        vm.prank(alice);
        pool.setPaused(ID, true);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 1, 0.1 ether, UptimePool.SkipReason.PoolPaused);
        assertEq(_charge(scheduler, ID, 0.1 ether, 1), 0);
        assertEq(_charge(mailer, ID, 0.01 ether, 1), 0);
        assertEq(pool.available(ID, SCHED), 0);
        vm.prank(alice);
        pool.setPaused(ID, false);
        assertEq(_charge(scheduler, ID, 0.1 ether, 2), 0.1 ether);
    }

    function testOnlyOwnerPauses() public {
        _open(alice, ID, 1 ether, 1 ether, 0);
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.setPaused(ID, false);
        vm.prank(admin);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.setPaused(ID, true);
    }

    function testAllowancePauseAndRevokeAreIndependentPerSpender() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        vm.prank(alice);
        pool.setAllowancePaused(ID, MAIL, true);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, MAIL, 1, 0.01 ether, UptimePool.SkipReason.AllowancePaused);
        assertEq(_charge(mailer, ID, 0.01 ether, 1), 0);
        assertEq(_charge(scheduler, ID, 0.1 ether, 1), 0.1 ether, "scheduler unaffected");

        vm.prank(alice);
        pool.revokeAllowance(ID, SCHED);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 2, 0.1 ether, UptimePool.SkipReason.NoAllowance);
        assertEq(_charge(scheduler, ID, 0.1 ether, 2), 0);

        vm.prank(bob);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.setAllowance(ID, SCHED, _terms(100 ether, 0));
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.NotPoolOwner.selector);
        pool.setAllowance(ID, SCHED, _terms(100 ether, 0));

        vm.prank(alice);
        vm.expectRevert(UptimePool.InvalidRole.selector);
        pool.revokeAllowance(ID, SCHED);
    }

    function testExpiryAndStartDate() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        UptimePool.Terms memory t = UptimePool.Terms({
            periodAmount: 1 ether,
            periodDuration: 1 days,
            startDate: uint64(block.timestamp + 1 hours),
            expiry: uint64(block.timestamp + 2 days),
            maxPerCharge: 0
        });
        vm.prank(alice);
        pool.setAllowance(ID, SCHED, t);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 1, 1, UptimePool.SkipReason.NotStarted);
        _charge(scheduler, ID, 1, 1);
        vm.warp(block.timestamp + 1 hours);
        assertEq(_charge(scheduler, ID, 1, 2), 1);
        vm.warp(t.expiry);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 3, 1, UptimePool.SkipReason.Expired);
        _charge(scheduler, ID, 1, 3);
        assertEq(pool.available(ID, SCHED), 0);

        t.expiry = t.startDate;
        vm.prank(alice);
        vm.expectRevert(UptimePool.InvalidTerms.selector);
        pool.setAllowance(ID, SCHED, t);
    }

    function testInsufficientBalanceUnknownPoolAndZeroAreSkipped() public {
        _open(alice, ID, 0.05 ether, 1 ether, 0);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 1, 0.1 ether, UptimePool.SkipReason.InsufficientBalance);
        _charge(scheduler, ID, 0.1 ether, 1);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID2, SCHED, 2, 1, UptimePool.SkipReason.NoPool);
        _charge(scheduler, ID2, 1, 2);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, SCHED, 3, 0, UptimePool.SkipReason.ZeroAmount);
        _charge(scheduler, ID, 0, 3);
        assertEq(_balance(ID), 0.05 ether);
        assertEq(pool.available(ID, SCHED), 0.05 ether, "available is bounded by balance");
    }

    function testOnePausedPoolDoesNotBlockTheBatch() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        _open(bob, ID2, 10 ether, 1 ether, 0);
        vm.prank(alice);
        pool.setPaused(ID, true);
        bytes32[] memory ids = new bytes32[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1]) = (ID, ID2);
        (amounts[0], amounts[1]) = (0.2 ether, 0.3 ether);
        vm.prank(scheduler);
        assertEq(pool.charge(ids, amounts, 1), 0.3 ether);
        assertEq(_balance(ID), 10 ether);
        assertEq(_balance(ID2), 9.7 ether);
    }

    function testBatchShapeIsChecked() public {
        bytes32[] memory ids = new bytes32[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.InvalidBatch.selector);
        pool.charge(ids, amounts, 1);
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.LengthMismatch.selector);
        pool.charge(new bytes32[](1), new uint256[](2), 1);
        uint256 n = pool.MAX_BATCH() + 1;
        bytes32[] memory big = new bytes32[](n);
        uint256[] memory bigAmounts = new uint256[](n);
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.InvalidBatch.selector);
        pool.charge(big, bigAmounts, 1);
    }

    function testReplacingAllowanceStartsFreshCount() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        _charge(scheduler, ID, 1 ether, 1);
        assertEq(pool.available(ID, SCHED), 0);
        vm.prank(alice);
        pool.setAllowance(ID, SCHED, _terms(0.5 ether, 0));
        assertEq(pool.available(ID, SCHED), 0.5 ether);
    }

    // ------------------------------------------------------------ reentrancy

    function testOwnerReentryDuringWithdrawFails() public {
        ReentrantOwner o = new ReentrantOwner(pool);
        vm.deal(address(o), 1);
        o.open{ value: 3 ether }(ID);
        for (uint8 m = 1; m <= 3; ++m) {
            o.setMode(m);
            vm.expectRevert(UptimePool.NativeTransferFailed.selector);
            o.pull(1 ether);
        }
        assertEq(_balance(ID), 3 ether);
        (, bool paused,) = pool.getPool(ID);
        assertFalse(paused);
        // Without re-entry the same owner withdraws fine.
        o.setMode(0);
        o.pull(1 ether);
        assertTrue(o.reentered());
        assertEq(_balance(ID), 2 ether);
    }

    function testSpenderReentryDuringChargeFails() public {
        ReentrantSpender s = new ReentrantSpender();
        UptimePool p = new UptimePool(admin, 0, address(s), mailer);
        s.setPool(p, ID, 0.1 ether);
        uint8[] memory roles = new uint8[](1);
        UptimePool.Terms[] memory terms = new UptimePool.Terms[](1);
        roles[0] = SCHED;
        terms[0] = _terms(10 ether, 0);
        vm.prank(alice);
        p.deposit{ value: 10 ether }(ID, roles, terms);
        vm.expectRevert(UptimePool.NativeTransferFailed.selector);
        s.run(1);
        (,, uint256 bal) = p.getPool(ID);
        assertEq(bal, 10 ether, "whole charge rolled back");
        assertEq(p.lastSettlement(SCHED), 0, "settlement id not consumed by a reverted charge");
    }

    // ------------------------------------------------------------ rotation

    function testRotationRespectsDelayAndOnlyAdmin() public {
        address next = makeAddr("next");
        vm.prank(bob);
        vm.expectRevert(UptimePool.NotAdmin.selector);
        pool.proposeSpender(SCHED, next);

        vm.prank(admin);
        pool.proposeSpender(SCHED, next);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.RotationNotReady.selector, block.timestamp + 48 hours));
        pool.executeSpender(SCHED);

        vm.warp(block.timestamp + 48 hours);
        vm.prank(bob);
        vm.expectRevert(UptimePool.NotAdmin.selector);
        pool.executeSpender(SCHED);
        vm.prank(admin);
        pool.executeSpender(SCHED);
        assertEq(pool.spenderOf(SCHED), next);
        assertEq(pool.roleOf(scheduler), 0);
        assertEq(pool.roleOf(next), SCHED);
    }

    function testRotatedOutSpenderLosesPowerAndSequenceContinues() public {
        _open(alice, ID, 10 ether, 1 ether, 0);
        _charge(scheduler, ID, 0.1 ether, 10);
        address next = makeAddr("next");
        vm.prank(admin);
        pool.proposeSpender(SCHED, next);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        pool.executeSpender(SCHED);

        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = ID;
        amounts[0] = 0.1 ether;
        vm.prank(scheduler);
        vm.expectRevert(UptimePool.NotSpender.selector);
        pool.charge(ids, amounts, 11);
        vm.prank(next);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.SettlementReplayed.selector, 10, 10));
        pool.charge(ids, amounts, 10);
        assertEq(_charge(next, ID, 0.1 ether, 11), 0.1 ether);
    }

    function testCancelAndClearRoleAndNoDoubleRole() public {
        vm.prank(admin);
        pool.proposeSpender(SCHED, mailer);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.SpenderHasRole.selector, MAIL));
        pool.executeSpender(SCHED);

        vm.prank(admin);
        pool.cancelSpender(SCHED);
        vm.prank(admin);
        vm.expectRevert(UptimePool.NoPendingSpender.selector);
        pool.executeSpender(SCHED);

        vm.prank(admin);
        pool.proposeSpender(MAIL, address(0));
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        pool.executeSpender(MAIL);
        assertEq(pool.spenderOf(MAIL), address(0));
        assertEq(pool.roleOf(mailer), 0);
    }

    function testZeroDelayDeploymentRotatesAtOnce() public {
        UptimePool p = new UptimePool(admin, 0, scheduler, address(0));
        vm.prank(admin);
        p.proposeSpender(MAIL, mailer);
        vm.prank(admin);
        p.executeSpender(MAIL);
        assertEq(p.spenderOf(MAIL), mailer);
    }

    function testConstructorGuards() public {
        vm.expectRevert(UptimePool.InvalidAdmin.selector);
        new UptimePool(address(0), 0, scheduler, mailer);
        vm.expectRevert(abi.encodeWithSelector(UptimePool.SpenderHasRole.selector, SCHED));
        new UptimePool(admin, 0, scheduler, scheduler);
    }

    // ------------------------------------------------------------ history

    function testHistoryRecordsEveryTransition() public {
        _open(alice, ID, 10 ether, 1 ether, 0); // create + 2 allowance sets
        vm.prank(alice);
        pool.topUp{ value: 1 ether }(ID);
        _charge(scheduler, ID, 0.1 ether, 1);
        vm.prank(alice);
        pool.setPaused(ID, true);
        vm.prank(alice);
        pool.withdraw(ID, 1 ether);
        (UptimePool.Operation[] memory ops, uint256 total) = pool.getHistory(0, 128);
        assertEq(total, 7);
        uint8[7] memory kinds = [1, 7, 7, 2, 4, 5, 3];
        for (uint256 i; i < 7; ++i) {
            assertEq(ops[i].kind, kinds[i]);
            assertEq(ops[i].uptimeId, ID);
        }
        assertEq(ops[4].actor, scheduler);
        assertEq(ops[4].recipient, scheduler);
        assertEq(ops[4].settlementId, 1);
        assertEq(ops[4].role, SCHED);
        assertEq(ops[6].recipient, alice);
        (ops, total) = pool.getHistory(7, 1);
        assertEq(ops.length, 0);
        vm.expectRevert(UptimePool.InvalidHistoryOffset.selector);
        pool.getHistory(8, 1);
        vm.expectRevert(UptimePool.InvalidHistoryLimit.selector);
        pool.getHistory(0, 0);
    }

    // ------------------------------------------------------------ fuzz

    /// Whatever the spender asks for over any sequence of times, it never gets more than one
    /// period's amount inside one window, nor more than the pool holds.
    function testFuzzNeverExceedsPeriodCap(uint96[8] memory asks, uint32[8] memory gaps) public {
        _open(alice, ID, 3 ether, 1 ether, 0);
        uint64 start = uint64(block.timestamp);
        uint256 window = type(uint256).max;
        uint256 inWindow;
        uint256 paidTotal;
        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + (gaps[i] % 2 days));
            uint256 w = (block.timestamp - start) / 1 days;
            if (w != window) {
                window = w;
                inWindow = 0;
            }
            uint256 paid = _charge(scheduler, ID, uint256(asks[i]) % 2 ether, i + 1);
            inWindow += paid;
            paidTotal += paid;
            assertLe(inWindow, 1 ether);
        }
        assertEq(_balance(ID), 3 ether - paidTotal);
        assertEq(address(pool).balance, pool.totalBalance());
    }
}
