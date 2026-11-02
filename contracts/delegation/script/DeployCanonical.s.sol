// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Script, console2 } from "forge-std/Script.sol";

/// @notice Replays MetaMask's exact CREATE2 deployments of Delegation Framework v1.3.0
///         (plus ERC-4337 EntryPoint v0.7) through the deterministic deployer
///         0x4e59b44847b379578588920ca78fbf26c0b4956c, reproducing the canonical addresses.
/// @dev    Idempotent: contracts that already have code are skipped. Any funded EOA can run
///         it; the sender is not part of any CREATE2 address (the DelegationManager owner,
///         MetaMask's 0xb0403b32f54d0bd752113f4009e8b534c6669f44, is baked into its initcode).
///
///   forge script script/DeployCanonical.s.sol --rpc-url bradbury --account <name> --broadcast
contract DeployCanonical is Script {
    address constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/manifest/canonical-v1.3.0.json"));
        require(vm.parseJsonAddress(json, ".factory") == FACTORY, "factory mismatch");
        require(FACTORY.code.length > 0, "CREATE2 deployer missing on this chain");
        uint256 n = _count(json);

        uint256 deployed;
        uint256 skipped;
        for (uint256 i = 0; i < n; i++) {
            string memory p = string.concat(".contracts[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(p, ".name"));
            address expected = vm.parseJsonAddress(json, string.concat(p, ".address"));
            bytes32 salt = vm.parseJsonBytes32(json, string.concat(p, ".salt"));
            bytes memory initcode = vm.parseJsonBytes(json, string.concat(p, ".initcode"));

            require(vm.computeCreate2Address(salt, keccak256(initcode), FACTORY) == expected, name);
            if (expected.code.length > 0) {
                console2.log("skip  (has code)", expected, name);
                skipped++;
                continue;
            }
            vm.broadcast();
            (bool ok, bytes memory ret) = FACTORY.call(abi.encodePacked(salt, initcode));
            require(ok && ret.length == 20 && address(bytes20(ret)) == expected, name);
            require(expected.code.length > 0, name);
            console2.log("deploy", expected, name);
            deployed++;
        }
        console2.log("deployed:", deployed, "skipped:", skipped);
    }

    function _count(string memory json) private view returns (uint256 c) {
        while (vm.keyExistsJson(json, string.concat(".contracts[", vm.toString(c), "]"))) c++;
    }
}
