// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { Script, console } from "forge-std/Script.sol";
import { UptimePoolV2 } from "../src/UptimePoolV2.sol";

/// @notice Deploys UptimePoolV2 through the standard CREATE2 factory, so the address is known before
/// anything is sent. PREPARED, NOT RUN. v1 (UptimePool) stays live until the app is switched (UPTIME_POOL_V2_BRADBURY).
///
/// NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
///
/// Simulate only (sends nothing; this is the default without --broadcast):
///   SCHEDULER=0x... MAILER=0x... forge script script/DeployUptimePoolV2.s.sol --rpc-url bradbury --force --account <name>
///
/// Deploy (owner's call; signs with the key given to forge, e.g. --account <keystore name>):
///   ... forge script script/DeployUptimePoolV2.s.sol --rpc-url bradbury --force --broadcast --account <name>
///
/// The owner's path is the signing page (sign/README.md): it creates the admin Safe and sends this
/// same CREATE2 calldata from MetaMask. This script is the forge equivalent.
///
/// Env: ADMIN (REQUIRED: the admin multisig, PRODUCT.md D11; it can never be a spender),
/// SCHEDULER and MAILER (the first spenders, set by the constructor with no wait; a role left
/// zero can only be filled later through proposeSpender + the delay), ROTATION_DELAY seconds
/// (default 172800 = 48 hours, which is also the contract's floor), SALT (bytes32, default 0).
contract DeployUptimePoolV2 is Script {
    /// Arachnid deterministic deployment proxy. Calldata is salt ++ initcode; returns the address.
    address constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 constant BRADBURY_CHAIN_ID = 4221;

    function run() external returns (address predicted) {
        // Inside a broadcast, tx.origin as forge reports it is the signing wallet (the deployer).
        vm.startBroadcast();
        (,, address deployer) = vm.readCallers();
        address admin = vm.envAddress("ADMIN");
        address scheduler = vm.envOr("SCHEDULER", address(0));
        address mailer = vm.envOr("MAILER", address(0));
        uint64 delay = uint64(vm.envOr("ROTATION_DELAY", uint256(48 hours)));
        bytes32 salt = vm.envOr("SALT", bytes32(0));

        require(block.chainid == BRADBURY_CHAIN_ID, "Not Bradbury (4221)");
        require(FACTORY.code.length != 0, "No CREATE2 factory at 0x4e59...956C on this chain");

        bytes memory initCode =
            abi.encodePacked(type(UptimePoolV2).creationCode, abi.encode(admin, delay, scheduler, mailer));
        predicted = vm.computeCreate2Address(salt, keccak256(initCode), FACTORY);
        require(predicted.code.length == 0, "Already deployed at this address; change SALT");

        (bool ok, bytes memory ret) = FACTORY.call(abi.encodePacked(salt, initCode));
        vm.stopBroadcast();
        require(ok && ret.length == 20 && address(bytes20(ret)) == predicted, "Deploy failed");

        UptimePoolV2 pool = UptimePoolV2(predicted);
        require(pool.admin() == admin, "Wrong admin");
        require(pool.rotationDelay() == delay, "Wrong delay");
        require(pool.spenderOf(1) == scheduler && pool.spenderOf(2) == mailer, "Wrong spenders");

        console.log("Chain id:      ", block.chainid);
        console.log("Deployer:      ", deployer);
        console.log("UptimePoolV2 at: ", predicted);
        console.log("Admin:         ", admin);
        console.log("Scheduler:     ", scheduler);
        console.log("Mailer:        ", mailer);
        console.log("Rotation delay:", delay);
    }
}
