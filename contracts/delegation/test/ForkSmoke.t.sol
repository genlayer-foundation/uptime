// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import "./Interfaces.sol";

/// @notice End-to-end smoke test against the CANONICAL addresses on a chain where
///         script/DeployCanonical.s.sol has run (anvil fork of Bradbury, or Bradbury itself
///         read-only). Skips itself when the framework is not deployed at the RPC given.
///
///   forge test --fork-url http://127.0.0.1:8545 -vv
///
/// Scenario (both account flavours): delegator grants an "Uptime" delegate a revocable GEN
/// allowance of 1 GEN per day via NativeTokenPeriodTransferEnforcer; the delegate pulls within
/// the limit, is refused over it, gets a fresh allowance next period, and is refused after
/// the delegator revokes.
contract ForkSmokeTest is Test {
    IDelegationManager constant DM = IDelegationManager(0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3);
    ISimpleFactory constant FACTORY = ISimpleFactory(0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c);
    address constant HYBRID_IMPL = 0x48dBe696A4D990079e039489bA2053B36E8FFEC4;
    address constant EIP7702_IMPL = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address constant PERIOD_ENFORCER = 0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9;
    IEntryPoint constant ENTRY_POINT = IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
    address constant CANONICAL_DM_OWNER = 0xB0403B32f54d0Bd752113f4009e8B534C6669f44;
    bytes32 constant ROOT_AUTHORITY = bytes32(type(uint256).max);
    bytes32 constant MODE_SINGLE_DEFAULT = bytes32(0);

    uint256 constant PERIOD_AMOUNT = 1 ether; // 1 GEN
    uint256 constant PERIOD = 1 days;

    address uptime; // the delegate (e.g. the Uptime pool / relayer)
    address payee = makeAddr("payee");

    function setUp() public {
        if (address(DM).code.length == 0) vm.skip(true);
        uptime = makeAddr("uptime");
    }

    // ------------------------------------------------------------------ deployment sanity

    function test_canonicalDeployment() public view {
        assertEq(block.chainid, 4221, "not chain 4221");
        assertEq(DM.owner(), CANONICAL_DM_OWNER, "DelegationManager owner");
        assertFalse(DM.paused());
        assertGt(HYBRID_IMPL.code.length, 0);
        assertGt(EIP7702_IMPL.code.length, 0);
        assertGt(PERIOD_ENFORCER.code.length, 0);
        assertGt(address(ENTRY_POINT).code.length, 0);
    }

    // ------------------------------------------------------------------ Hybrid smart account

    function test_hybridSmartAccount_periodAllowance_redeem_limit_revoke() public {
        (address owner, uint256 ownerPk) = makeAddrAndKey("owner");
        vm.deal(owner, 1 ether);

        // 1. create the smart account (ERC1967Proxy -> HybridDeleGator) via SimpleFactory
        bytes memory proxyCode = vm.parseBytes(vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/ERC1967Proxy.creation.hex")));
        bytes memory init = abi.encodeCall(
            IHybridDeleGator.initialize, (owner, new string[](0), new uint256[](0), new uint256[](0))
        );
        address account = FACTORY.deploy(abi.encodePacked(proxyCode, abi.encode(HYBRID_IMPL, init)), keccak256("uptime-smoke"));
        assertEq(IHybridDeleGator(account).owner(), owner);
        vm.deal(account, 10 ether);

        // 2. sign the delegation (owner ECDSA over the EIP-712 typed-data hash -> ERC-1271)
        Delegation memory d = _delegation(account, 1);
        d.signature = _sign(ownerPk, d);

        // 3. redeem within / over the limit / next period
        _allowanceFlow(d, account);

        // 4. revoke: owner submits a userOp through EntryPoint v0.7 (owner is its own bundler)
        PackedUserOperation memory op = PackedUserOperation({
            sender: account,
            nonce: ENTRY_POINT.getNonce(account, 0),
            initCode: "",
            callData: abi.encodeCall(IHybridDeleGator.disableDelegation, (d)),
            accountGasLimits: bytes32((uint256(300_000) << 128) | uint256(300_000)),
            preVerificationGas: 60_000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)),
            paymasterAndData: "",
            signature: ""
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, IHybridDeleGator(account).getPackedUserOperationTypedDataHash(op));
        op.signature = abi.encodePacked(r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(owner, owner);
        ENTRY_POINT.handleOps(ops, payable(owner));

        bytes32 h = DM.getDelegationHash(d);
        assertTrue(DM.disabledDelegations(h), "not revoked");
        vm.expectRevert(bytes4(keccak256("CannotUseADisabledDelegation()")));
        _redeem(d, 0.1 ether);
    }

    // ------------------------------------------------------------------ EIP-7702 EOA

    function test_eip7702Eoa_periodAllowance_redeem_limit_revoke() public {
        (address eoa, uint256 eoaPk) = makeAddrAndKey("eoa7702");
        vm.deal(eoa, 10 ether);

        // 1. upgrade the EOA in place: type-4 authorization -> EIP7702StatelessDeleGator
        vm.signAndAttachDelegation(EIP7702_IMPL, eoaPk);
        (bool ok,) = eoa.call("");
        ok; // empty call just carries the authorization
        assertEq(eoa.code, abi.encodePacked(hex"ef0100", EIP7702_IMPL), "7702 designator");

        // 2. sign with the EOA key (StatelessDeleGator: ecrecover == address(this))
        Delegation memory d = _delegation(eoa, 2);
        d.signature = _sign(eoaPk, d);

        // 3. same allowance flow
        _allowanceFlow(d, eoa);

        // 4. revoke: the EOA calls itself (onlyEntryPointOrSelf) -> DelegationManager
        vm.prank(eoa, eoa);
        IHybridDeleGator(eoa).disableDelegation(d);
        assertTrue(DM.disabledDelegations(DM.getDelegationHash(d)), "not revoked");
        vm.expectRevert(bytes4(keccak256("CannotUseADisabledDelegation()")));
        _redeem(d, 0.1 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _allowanceFlow(Delegation memory d, address delegator) internal {
        bytes32 h = DM.getDelegationHash(d);
        uint256 before = delegator.balance;

        _redeem(d, 0.6 ether); // within limit
        assertEq(payee.balance, 0.6 ether);

        vm.expectRevert(bytes("NativeTokenPeriodTransferEnforcer:transfer-amount-exceeded"));
        _redeem(d, 0.6 ether); // 1.2 > 1.0 in this period

        _redeem(d, 0.4 ether); // exactly reaches the cap
        (uint256 avail,,) = INativeTokenPeriodTransferEnforcer(PERIOD_ENFORCER).getAvailableAmount(
            h, address(DM), d.caveats[0].terms
        );
        assertEq(avail, 0);

        vm.warp(block.timestamp + PERIOD); // next period refills
        _redeem(d, 0.6 ether);
        assertEq(payee.balance, 1.6 ether);
        assertEq(delegator.balance, before - 1.6 ether);

        // the delegate is the only redeemer
        vm.expectRevert(bytes4(keccak256("InvalidDelegate()")));
        _redeemAs(makeAddr("stranger"), d, 0.1 ether);
    }

    function _delegation(address delegator, uint256 salt) internal returns (Delegation memory d) {
        Caveat[] memory caveats = new Caveat[](1);
        caveats[0] = Caveat({
            enforcer: PERIOD_ENFORCER,
            terms: abi.encodePacked(PERIOD_AMOUNT, PERIOD, block.timestamp),
            args: ""
        });
        d = Delegation({
            delegate: uptime,
            delegator: delegator,
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: salt,
            signature: ""
        });
        payee = makeAddr(string.concat("payee", vm.toString(salt)));
    }

    function _sign(uint256 pk, Delegation memory d) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", DM.getDomainHash(), DM.getDelegationHash(d)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _redeem(Delegation memory d, uint256 amount) internal {
        _redeemAs(uptime, d, amount);
    }

    function _redeemAs(address who, Delegation memory d, uint256 amount) internal {
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = d;
        bytes[] memory ctx = new bytes[](1);
        ctx[0] = abi.encode(chain);
        bytes32[] memory modes = new bytes32[](1);
        modes[0] = MODE_SINGLE_DEFAULT;
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodePacked(payee, amount, ""); // ExecutionLib.encodeSingle: plain GEN transfer
        vm.prank(who);
        DM.redeemDelegations(ctx, modes, calls);
    }
}
