// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Test } from "forge-std/Test.sol";
import { UptimePoolV2 } from "../src/UptimePoolV2.sol";

/// Backer contract whose receive() tries to re-enter the pool.
contract ReentrantBacker {
    UptimePoolV2 internal pool;
    bytes32 internal id;
    uint8 public mode; // 1 = re-withdraw, 2 = topUp, 3 = setPaused

    constructor(UptimePoolV2 pool_) {
        pool = pool_;
    }

    function open(bytes32 id_) external payable {
        id = id_;
        pool.deposit{ value: msg.value }(id_, new uint8[](0), new UptimePoolV2.Terms[](0));
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function pull(uint256 amount) external {
        pool.withdraw(id, amount);
    }

    receive() external payable {
        if (mode == 1) pool.withdraw(id, 1);
        else if (mode == 2) pool.topUp{ value: 1 }(id);
        else if (mode == 3) pool.setPaused(id, true);
    }
}

/// Spender contract whose receive() tries to charge again.
contract ReentrantSpenderV2 {
    UptimePoolV2 public pool;
    bytes32 internal id;
    uint256 internal amount;

    function setPool(UptimePoolV2 pool_, bytes32 id_, uint256 amount_) external {
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

contract RefuserV2 {
    UptimePoolV2 internal pool;

    constructor(UptimePoolV2 pool_) {
        pool = pool_;
    }

    function back(bytes32 id) external payable {
        pool.topUp{ value: msg.value }(id);
    }

    function pull(bytes32 id, uint256 amount) external {
        pool.withdraw(id, amount);
    }
}

contract UptimePoolV2Test is Test {
    uint256 internal constant ALL_ = type(uint256).max;
    UptimePoolV2 internal pool;
    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal mailer = makeAddr("mailer");
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant ID = keccak256("job-1");
    bytes32 internal constant ID2 = keccak256("job-2");
    uint256 internal sid;

    event Contributed(bytes32 indexed uptimeId, address indexed contributor, uint256 amount, uint256 shares);
    event Withdrawn(
        bytes32 indexed uptimeId,
        address indexed contributor,
        address indexed recipient,
        uint256 amount,
        uint256 shares
    );
    event SharesReset(bytes32 indexed uptimeId, uint64 epoch);
    event ChargeSkipped(
        bytes32 indexed uptimeId,
        uint8 indexed role,
        uint256 indexed settlementId,
        uint256 amount,
        UptimePoolV2.SkipReason reason
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        pool = new UptimePoolV2(admin, 48 hours, scheduler, mailer);
        vm.deal(owner, 1_000 ether);
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(stranger, 1_000 ether);
    }

    // ------------------------------------------------------------ helpers

    function _terms(uint128 perPeriod, uint128 perCharge) internal pure returns (UptimePoolV2.Terms memory) {
        return UptimePoolV2.Terms(perPeriod, 1 days, 0, 0, perCharge);
    }

    function _open(bytes32 id, address who, uint256 value) internal {
        uint8[] memory roles = new uint8[](2);
        UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](2);
        roles[0] = 1;
        roles[1] = 2;
        terms[0] = _terms(100 ether, 10 ether);
        terms[1] = _terms(1 ether, 0.1 ether);
        vm.prank(who);
        pool.deposit{ value: value }(id, roles, terms);
    }

    function _back(bytes32 id, address who, uint256 value) internal {
        vm.prank(who);
        pool.topUp{ value: value }(id);
    }

    function _charge(address spender, bytes32 id, uint256 amount) internal returns (uint256) {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        vm.prank(spender);
        return pool.charge(ids, amounts, ++sid);
    }

    function _bal(bytes32 id) internal view returns (uint256 b) {
        (,, b) = pool.getPool(id);
    }

    // ------------------------------------------------------------ create + contribute

    function testDepositCreatesPoolOwnerIsFirstBacker() public {
        _open(ID, owner, 10 ether);
        (address o, bool paused, uint256 b) = pool.getPool(ID);
        assertEq(o, owner);
        assertFalse(paused);
        assertEq(b, 10 ether);
        assertEq(pool.balanceOf(ID, owner), 10 ether);
        assertEq(pool.sharesOf(ID, owner), 10 ether * pool.SCALE());
        (uint256 backers, uint256 bal) = pool.getBacking(ID);
        assertEq(backers, 1);
        assertEq(bal, 10 ether);
        assertEq(pool.totalBalance(), 10 ether);
        (UptimePoolV2.Terms memory t,,,, bool active) = pool.getAllowance(ID, 1);
        assertTrue(active);
        assertEq(t.maxPerCharge, 10 ether);
        assertEq(t.startDate, block.timestamp);
    }

    function testDepositGuards() public {
        _open(ID, owner, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.PoolExists.selector);
        pool.deposit{ value: 1 ether }(ID, new uint8[](0), new UptimePoolV2.Terms[](0));
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.deposit(ID2, new uint8[](0), new UptimePoolV2.Terms[](0));
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.InvalidUptimeId.selector);
        pool.deposit{ value: 1 }(bytes32(0), new uint8[](0), new UptimePoolV2.Terms[](0));
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.LengthMismatch.selector);
        pool.deposit{ value: 1 }(ID2, new uint8[](1), new UptimePoolV2.Terms[](0));
        uint8[] memory roles = new uint8[](1);
        roles[0] = 1;
        UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](1);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.InvalidTerms.selector);
        pool.deposit{ value: 1 }(ID2, roles, terms);
    }

    function testAnyoneCanBackAndIsRecorded() public {
        _open(ID, owner, 10 ether);
        vm.expectEmit(true, true, false, true);
        emit Contributed(ID, alice, 5 ether, 5 ether * 1e18);
        _back(ID, alice, 5 ether);
        _back(ID, bob, 1 ether);
        _back(ID, alice, 1 ether); // second contribution: same backer
        assertEq(pool.balanceOf(ID, alice), 6 ether);
        assertEq(pool.balanceOf(ID, bob), 1 ether);
        (uint256 backers, uint256 bal) = pool.getBacking(ID);
        assertEq(backers, 3);
        assertEq(bal, 17 ether);
        (address[] memory who, uint256[] memory bals, uint256 total) = pool.getContributors(ID, 0, 10);
        assertEq(total, 3);
        assertEq(who[0], owner);
        assertEq(who[1], alice);
        assertEq(who[2], bob);
        assertEq(bals[1], 6 ether);
    }

    function testTopUpUnknownPoolAndZeroRevert() public {
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.UnknownPool.selector);
        pool.topUp{ value: 1 ether }(ID);
        _open(ID, owner, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.topUp(ID);
    }

    function testBackingAPausedPoolIsAllowed() public {
        _open(ID, owner, 1 ether);
        vm.prank(owner);
        pool.setPaused(ID, true);
        _back(ID, alice, 1 ether);
        assertEq(pool.balanceOf(ID, alice), 1 ether);
    }

    function testPlainTransfersAreRejected() public {
        vm.prank(alice);
        (bool ok,) = address(pool).call{ value: 1 ether }("");
        assertFalse(ok);
        vm.prank(alice);
        (ok,) = address(pool).call{ value: 1 ether }(hex"deadbeef");
        assertFalse(ok);
    }

    // ------------------------------------------------------------ pro-rata charges

    function testChargesArePaidProRata() public {
        _open(ID, owner, 30 ether);
        _back(ID, alice, 10 ether); // owner 75%, alice 25%
        _charge(scheduler, ID, 8 ether);
        assertEq(_bal(ID), 32 ether);
        assertEq(pool.balanceOf(ID, owner), 24 ether);
        assertEq(pool.balanceOf(ID, alice), 8 ether);
        assertEq(scheduler.balance, 8 ether);
        // a later backer is not charged for earlier runs
        _back(ID, bob, 8 ether);
        assertApproxEqAbs(pool.balanceOf(ID, bob), 8 ether, 1);
        _charge(scheduler, ID, 4 ether); // 40 -> 36: everyone loses 10%
        assertApproxEqAbs(pool.balanceOf(ID, owner), 21.6 ether, 1);
        assertApproxEqAbs(pool.balanceOf(ID, alice), 7.2 ether, 1);
        assertApproxEqAbs(pool.balanceOf(ID, bob), 7.2 ether, 1);
        _assertBooks(ID);
    }

    function testChargedEmptyResetsSharesAndNextBackerStartsFresh() public {
        _open(ID, owner, 5 ether);
        _back(ID, alice, 5 ether);
        _charge(scheduler, ID, 10 ether);
        assertEq(_bal(ID), 0);
        (uint256 backers,) = pool.getBacking(ID);
        assertEq(backers, 0);
        assertEq(pool.balanceOf(ID, owner), 0);
        (uint256 ts, uint64 epoch) = pool.getShares(ID);
        assertEq(ts, 0);
        assertEq(epoch, 2);
        // old shares are worthless; a new contribution gets its full value
        _back(ID, bob, 3 ether);
        assertEq(pool.balanceOf(ID, bob), 3 ether);
        assertEq(pool.sharesOf(ID, owner), 0);
        _back(ID, alice, 1 ether);
        assertEq(pool.balanceOf(ID, alice), 1 ether);
        (backers,) = pool.getBacking(ID);
        assertEq(backers, 2);
        vm.prank(owner);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.withdraw(ID, ALL_);
        _assertBooks(ID);
    }

    // ------------------------------------------------------------ withdraw

    function testEachBackerWithdrawsOnlyTheirOwnShare() public {
        _open(ID, owner, 10 ether);
        _back(ID, alice, 10 ether);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.InsufficientBalance.selector, 10 ether, 11 ether));
        pool.withdraw(ID, 11 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.InsufficientBalance.selector, 0, 1));
        pool.withdraw(ID, 1);
        vm.prank(stranger);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.withdraw(ID, ALL_);

        uint256 before = alice.balance;
        vm.prank(alice);
        pool.withdraw(ID, 4 ether);
        assertEq(alice.balance - before, 4 ether);
        assertEq(pool.balanceOf(ID, alice), 6 ether);
        assertEq(pool.balanceOf(ID, owner), 10 ether);
    }

    function testWithdrawAllWhilePausedAndAfterCharges() public {
        _open(ID, owner, 10 ether);
        _back(ID, alice, 10 ether);
        _charge(scheduler, ID, 2 ether);
        vm.prank(owner);
        pool.setPaused(ID, true);
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 got = pool.withdraw(ID, ALL_);
        assertEq(got, 9 ether);
        assertEq(alice.balance - before, 9 ether);
        (uint256 backers,) = pool.getBacking(ID);
        assertEq(backers, 1);
    }

    function testLastOutLeavesExactlyZero() public {
        _open(ID, owner, 7 ether);
        _back(ID, alice, 3 ether);
        _back(ID, bob, 1);
        _charge(scheduler, ID, uint256(1 ether) / 3);
        vm.prank(alice);
        pool.withdraw(ID, ALL_);
        vm.prank(bob);
        pool.withdraw(ID, ALL_);
        vm.prank(owner);
        pool.withdraw(ID, ALL_);
        assertEq(_bal(ID), 0);
        assertEq(pool.totalBalance(), 0);
        assertEq(address(pool).balance, 0);
        (uint256 ts,) = pool.getShares(ID);
        assertEq(ts, 0);
    }

    function testSoleBackerPartialWithdrawNeverStrandsGen() public {
        _open(ID, owner, 1 ether);
        _charge(scheduler, ID, uint256(1 ether) / 3);
        uint256 b = _bal(ID);
        vm.prank(owner);
        pool.withdraw(ID, b - 1);
        assertEq(pool.balanceOf(ID, owner), 1);
        assertGt(pool.sharesOf(ID, owner), 0);
        vm.prank(owner);
        pool.withdraw(ID, 1);
        assertEq(_bal(ID), 0);
    }

    function testWithdrawToRecipientAndGuards() public {
        _open(ID, owner, 2 ether);
        _back(ID, alice, 2 ether);
        address payable to = payable(makeAddr("to"));
        vm.expectEmit(true, true, true, false);
        emit Withdrawn(ID, alice, to, 1 ether, 0);
        vm.prank(alice);
        pool.withdrawTo(ID, 1 ether, to);
        assertEq(to.balance, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.InvalidRecipient.selector);
        pool.withdrawTo(ID, 1, payable(address(0)));
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.ZeroAmount.selector);
        pool.withdraw(ID, 0);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.UnknownPool.selector);
        pool.withdraw(ID2, 1);
    }

    function testRejectedTransferRevertsAndKeepsShare() public {
        _open(ID, owner, 1 ether);
        RefuserV2 r = new RefuserV2(pool);
        r.back{ value: 1 ether }(ID);
        vm.expectRevert(UptimePoolV2.NativeTransferFailed.selector);
        r.pull(ID, 1 ether);
        assertEq(pool.balanceOf(ID, address(r)), 1 ether);
    }

    function testOwnerCannotTakeBackersGen() public {
        _open(ID, owner, 1 ether);
        _back(ID, alice, 100 ether);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.InsufficientBalance.selector, 1 ether, 100 ether));
        pool.withdraw(ID, 100 ether);
        vm.prank(owner);
        assertEq(pool.withdraw(ID, ALL_), 1 ether);
        assertEq(pool.balanceOf(ID, alice), 100 ether);
    }

    // ------------------------------------------------------------ owner powers

    function testOnlyOwnerPausesAndSetsAllowances() public {
        _open(ID, owner, 1 ether);
        _back(ID, alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert(UptimePoolV2.NotPoolOwner.selector);
        pool.setPaused(ID, true);
        vm.expectRevert(UptimePoolV2.NotPoolOwner.selector);
        pool.setAllowance(ID, 1, _terms(1 ether, 0));
        vm.expectRevert(UptimePoolV2.NotPoolOwner.selector);
        pool.setAllowancePaused(ID, 1, true);
        vm.expectRevert(UptimePoolV2.NotPoolOwner.selector);
        pool.revokeAllowance(ID, 1);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.UnknownPool.selector);
        pool.setPaused(ID2, true);
    }

    function testPausedPoolIsSkippedForEverySpender() public {
        _open(ID, owner, 1 ether);
        vm.prank(owner);
        pool.setPaused(ID, true);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, 1, 1, 0.1 ether, UptimePoolV2.SkipReason.PoolPaused);
        assertEq(_charge(scheduler, ID, 0.1 ether), 0);
        assertEq(_charge(mailer, ID, 0.01 ether), 0);
        assertEq(pool.available(ID, 1), 0);
        vm.prank(owner);
        pool.setPaused(ID, false);
        assertEq(_charge(scheduler, ID, 0.1 ether), 0.1 ether);
    }

    function testAllowancePauseAndRevokeArePerSpender() public {
        _open(ID, owner, 5 ether);
        vm.prank(owner);
        pool.setAllowancePaused(ID, 1, true);
        assertEq(_charge(scheduler, ID, 1 ether), 0);
        assertEq(_charge(mailer, ID, 0.1 ether), 0.1 ether);
        vm.prank(owner);
        pool.setAllowancePaused(ID, 1, false);
        assertEq(_charge(scheduler, ID, 1 ether), 1 ether);
        vm.prank(owner);
        pool.revokeAllowance(ID, 2);
        assertEq(_charge(mailer, ID, 0.1 ether), 0);
        vm.prank(owner);
        vm.expectRevert(UptimePoolV2.InvalidRole.selector);
        pool.revokeAllowance(ID, 2);
        vm.prank(owner);
        vm.expectRevert(UptimePoolV2.InvalidRole.selector);
        pool.setAllowancePaused(ID, 2, true);
    }

    // ------------------------------------------------------------ spender rules (v1 parity)

    function testNonSpenderCannotCharge() public {
        _open(ID, owner, 1 ether);
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = ID;
        a[0] = 1;
        vm.prank(owner);
        vm.expectRevert(UptimePoolV2.NotSpender.selector);
        pool.charge(ids, a, 1);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.NotSpender.selector);
        pool.charge(ids, a, 1);
    }

    function testReplayedSettlementRevertsAndSkippedLineConsumesId() public {
        _open(ID, owner, 1 ether);
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = ID;
        a[0] = 100 ether; // over cap: skipped
        vm.prank(scheduler);
        assertEq(pool.charge(ids, a, 5), 0);
        assertEq(pool.lastSettlement(1), 5);
        a[0] = 1;
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.SettlementReplayed.selector, 5, 5));
        pool.charge(ids, a, 5);
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.SettlementReplayed.selector, 5, 4));
        pool.charge(ids, a, 4);
        // the mailer has its own sequence
        vm.prank(mailer);
        pool.charge(ids, a, 1);
    }

    function testLineCapPeriodCapAndNoCarryOver() public {
        _open(ID, owner, 500 ether);
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, 1, 1, 10 ether + 1, UptimePoolV2.SkipReason.OverLineCap);
        assertEq(_charge(scheduler, ID, 10 ether + 1), 0);
        for (uint256 i; i < 10; ++i) {
            assertEq(_charge(scheduler, ID, 10 ether), 10 ether);
        }
        vm.expectEmit(true, true, true, true);
        emit ChargeSkipped(ID, 1, 12, 1, UptimePoolV2.SkipReason.OverPeriodCap);
        assertEq(_charge(scheduler, ID, 1), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(pool.available(ID, 1), 10 ether);
        assertEq(_charge(scheduler, ID, 10 ether), 10 ether);
    }

    function testStartDateExpiryAndEmptySkips() public {
        _open(ID, owner, 1 ether);
        vm.prank(owner);
        pool.setAllowance(ID, 1, UptimePoolV2.Terms(1 ether, 1 days, uint64(block.timestamp + 100), 0, 0));
        assertEq(_charge(scheduler, ID, 1), 0);
        vm.warp(block.timestamp + 100);
        assertEq(_charge(scheduler, ID, 1), 1);
        vm.prank(owner);
        pool.setAllowance(ID, 1, UptimePoolV2.Terms(1 ether, 1 days, 0, uint64(block.timestamp + 10), 0));
        vm.warp(block.timestamp + 10);
        assertEq(_charge(scheduler, ID, 1), 0);
        vm.prank(owner);
        pool.setAllowance(ID, 1, _terms(100 ether, 0));
        assertEq(_charge(scheduler, ID, 0), 0); // ZeroAmount
        assertEq(_charge(scheduler, ID, 2 ether), 0); // InsufficientBalance
        assertEq(_charge(scheduler, ID2, 1), 0); // NoPool
        vm.prank(owner);
        vm.expectRevert(UptimePoolV2.InvalidTerms.selector);
        pool.setAllowance(ID, 1, UptimePoolV2.Terms(1, 1 days, 100, 50, 0));
    }

    function testBatchShapeAndOnePausedPoolDoesNotBlockOthers() public {
        _open(ID, owner, 1 ether);
        _open(ID2, alice, 1 ether);
        vm.prank(owner);
        pool.setPaused(ID, true);
        bytes32[] memory ids = new bytes32[](2);
        uint256[] memory a = new uint256[](2);
        ids[0] = ID;
        ids[1] = ID2;
        a[0] = 0.1 ether;
        a[1] = 0.2 ether;
        vm.prank(scheduler);
        assertEq(pool.charge(ids, a, 1), 0.2 ether);
        vm.startPrank(scheduler);
        vm.expectRevert(UptimePoolV2.LengthMismatch.selector);
        pool.charge(ids, new uint256[](1), 2);
        vm.expectRevert(UptimePoolV2.InvalidBatch.selector);
        pool.charge(new bytes32[](0), new uint256[](0), 2);
        vm.expectRevert(UptimePoolV2.InvalidBatch.selector);
        pool.charge(new bytes32[](257), new uint256[](257), 2);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ reentrancy

    function testBackerReentryDuringWithdrawFails() public {
        ReentrantBacker r = new ReentrantBacker(pool);
        vm.deal(address(r), 0);
        r.open{ value: 2 ether }(ID);
        for (uint8 m = 1; m <= 3; ++m) {
            r.setMode(m);
            vm.expectRevert(UptimePoolV2.NativeTransferFailed.selector);
            r.pull(1 ether);
        }
        assertEq(pool.balanceOf(ID, address(r)), 2 ether);
    }

    function testSpenderReentryDuringChargeFails() public {
        ReentrantSpenderV2 s = new ReentrantSpenderV2();
        UptimePoolV2 p = new UptimePoolV2(admin, 0, address(s), address(0));
        s.setPool(p, ID, 0.1 ether);
        uint8[] memory roles = new uint8[](1);
        roles[0] = 1;
        UptimePoolV2.Terms[] memory terms = new UptimePoolV2.Terms[](1);
        terms[0] = _terms(1 ether, 0);
        vm.prank(owner);
        p.deposit{ value: 1 ether }(ID, roles, terms);
        vm.expectRevert(UptimePoolV2.NativeTransferFailed.selector);
        s.run(1);
        (,, uint256 b) = p.getPool(ID);
        assertEq(b, 1 ether);
    }

    // ------------------------------------------------------------ admin

    function testRotationRespectsDelayAndOnlyAdmin() public {
        address next = makeAddr("next");
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.NotAdmin.selector);
        pool.proposeSpender(1, next);
        vm.prank(admin);
        vm.expectRevert(UptimePoolV2.InvalidRole.selector);
        pool.proposeSpender(0, next);
        vm.prank(admin);
        pool.proposeSpender(1, next);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(UptimePoolV2.RotationNotReady.selector, block.timestamp + 48 hours)
        );
        pool.executeSpender(1);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(alice);
        vm.expectRevert(UptimePoolV2.NotAdmin.selector);
        pool.executeSpender(1);
        vm.prank(admin);
        pool.executeSpender(1);
        assertEq(pool.spenderOf(1), next);
        assertEq(pool.roleOf(scheduler), 0);
        _open(ID, owner, 1 ether);
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory a = new uint256[](1);
        ids[0] = ID;
        a[0] = 1;
        vm.prank(scheduler);
        vm.expectRevert(UptimePoolV2.NotSpender.selector);
        pool.charge(ids, a, 1);
        vm.prank(next);
        pool.charge(ids, a, 1);
    }

    function testCancelNoDoubleRoleAndConstructorGuards() public {
        vm.prank(admin);
        vm.expectRevert(UptimePoolV2.NoPendingSpender.selector);
        pool.cancelSpender(1);
        vm.prank(admin);
        pool.proposeSpender(1, mailer);
        vm.prank(admin);
        pool.cancelSpender(1);
        (,, bool exists) = pool.pendingSpender(1);
        assertFalse(exists);
        vm.prank(admin);
        pool.proposeSpender(1, mailer);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.SpenderHasRole.selector, 2));
        pool.executeSpender(1);
        vm.expectRevert(UptimePoolV2.InvalidAdmin.selector);
        new UptimePoolV2(address(0), 0, scheduler, mailer);
        vm.expectRevert(abi.encodeWithSelector(UptimePoolV2.SpenderHasRole.selector, 1));
        new UptimePoolV2(admin, 0, scheduler, scheduler);
    }

    // ------------------------------------------------------------ history + pagination

    function testHistoryAndContributorPagination() public {
        _open(ID, owner, 1 ether); // create + 2 allowances = 3 ops
        _back(ID, alice, 1 ether); // 4
        _charge(scheduler, ID, 0.5 ether); // 5
        vm.prank(alice);
        pool.withdraw(ID, ALL_); // 6
        (UptimePoolV2.Operation[] memory ops, uint256 total) = pool.getHistory(0, 128);
        assertEq(total, 6);
        assertEq(ops[0].kind, 1);
        assertEq(ops[0].actor, owner);
        assertEq(ops[3].kind, 2);
        assertEq(ops[3].actor, alice);
        assertEq(ops[4].kind, 4);
        assertEq(ops[4].settlementId, 1);
        assertEq(ops[5].kind, 3);
        assertEq(ops[5].recipient, alice);
        vm.expectRevert(UptimePoolV2.InvalidHistoryLimit.selector);
        pool.getHistory(0, 129);
        vm.expectRevert(UptimePoolV2.InvalidHistoryOffset.selector);
        pool.getHistory(7, 1);
        (address[] memory who, uint256[] memory bals, uint256 n) = pool.getContributors(ID, 1, 1);
        assertEq(n, 2);
        assertEq(who.length, 1);
        assertEq(who[0], alice);
        assertEq(bals[0], 0);
        (who,,) = pool.getContributors(ID, 2, 5);
        assertEq(who.length, 0);
        vm.expectRevert(UptimePoolV2.InvalidHistoryOffset.selector);
        pool.getContributors(ID, 3, 5);
        (uint256 backers,) = pool.getBacking(ID);
        assertEq(backers, 1);
    }

    // ------------------------------------------------------------ fuzz: random sequences

    /// Any sequence of contribute / charge / withdraw / withdraw-all keeps the books exact.
    function testFuzzBooksStayExact(uint256 seed, uint8 steps) public {
        address[4] memory who = [owner, alice, bob, stranger];
        _open(ID, owner, 1 ether);
        steps = uint8(bound(steps, 1, 60));
        for (uint256 i; i < steps; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address w = who[seed % 4];
            uint256 op = (seed >> 8) % 4;
            uint256 amt = (seed >> 16) % 7 ether + 1;
            if (op == 0) {
                _back(ID, w, amt);
            } else if (op == 1) {
                _charge(scheduler, ID, amt % 10 ether);
            } else if (op == 2) {
                uint256 b = pool.balanceOf(ID, w);
                if (b > 0) {
                    vm.prank(w);
                    pool.withdraw(ID, amt % b + 1);
                }
            } else if (pool.sharesOf(ID, w) > 0) {
                vm.prank(w);
                pool.withdraw(ID, ALL_);
            }
            vm.warp(block.timestamp + (seed >> 32) % 1 hours);
            _assertBooks(ID);
        }
        // everyone leaves: the pool is exactly empty
        for (uint256 j; j < 4; ++j) {
            if (pool.sharesOf(ID, who[j]) > 0) {
                vm.prank(who[j]);
                pool.withdraw(ID, ALL_);
            }
        }
        assertEq(_bal(ID), 0);
        assertEq(pool.totalBalance(), 0);
        assertEq(address(pool).balance, 0);
    }

    function _assertBooks(bytes32 id) internal view {
        (address[] memory who, uint256[] memory bals,) = pool.getContributors(id, 0, 128);
        uint256 sum;
        uint256 holders;
        for (uint256 i; i < who.length; ++i) {
            sum += bals[i];
            if (pool.sharesOf(id, who[i]) > 0) holders++;
        }
        uint256 b = _bal(id);
        (uint256 backers,) = pool.getBacking(id);
        assertEq(backers, holders, "backers count");
        assertLe(sum, b, "sum of backers > pool");
        assertLe(b - sum, holders, "dust > 1 wei per backer");
        assertEq(pool.totalBalance(), address(pool).balance, "totalBalance != held");
    }
}
