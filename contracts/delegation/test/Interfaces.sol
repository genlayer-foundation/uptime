// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

// Minimal ABI surface of MetaMask Delegation Framework v1.3.0 and ERC-4337 EntryPoint v0.7,
// hand-written from upstream src/ (MIT AND Apache-2.0) so the smoke test exercises the
// REAL deployed bytecode at the canonical addresses without vendoring the framework.

struct Caveat {
    address enforcer;
    bytes terms;
    bytes args;
}

struct Delegation {
    address delegate;
    address delegator;
    bytes32 authority;
    Caveat[] caveats;
    uint256 salt;
    bytes signature;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IDelegationManager {
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external;
    function getDelegationHash(Delegation calldata d) external pure returns (bytes32);
    function getDomainHash() external view returns (bytes32);
    function disabledDelegations(bytes32 h) external view returns (bool);
    function owner() external view returns (address);
    function paused() external view returns (bool);
}

interface ISimpleFactory {
    function deploy(bytes memory bytecode, bytes32 salt) external returns (address);
}

interface IHybridDeleGator {
    function initialize(address owner, string[] calldata keyIds, uint256[] calldata xs, uint256[] calldata ys)
        external;
    function owner() external view returns (address);
    function disableDelegation(Delegation calldata d) external;
    function isDelegationDisabled(bytes32 h) external view returns (bool);
    function getPackedUserOperationTypedDataHash(PackedUserOperation calldata op) external view returns (bytes32);
    function getNonce() external view returns (uint256);
}

interface IEntryPoint {
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

interface INativeTokenPeriodTransferEnforcer {
    function getAvailableAmount(bytes32 delegationHash, address delegationManager, bytes calldata terms)
        external
        view
        returns (uint256 available, bool isNewPeriod, uint256 currentPeriod);
}
