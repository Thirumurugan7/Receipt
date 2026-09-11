// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ReceiptEscrow} from "../src/ReceiptEscrow.sol";

/**
 * Deploy ReceiptEscrow.
 *
 * Hedera testnet:
 *   VALUE_SCALE=10000000000   (1e10 weibars per tinybar)
 *   forge script script/Deploy.s.sol --rpc-url $HEDERA_RPC_URL --broadcast
 *
 * Base Sepolia fallback (BUILD.md §6 escape hatch), where the signed amount is
 * already wei:
 *   VALUE_SCALE=1
 */
contract Deploy is Script {
    function run() external returns (ReceiptEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address adjudicator = vm.envAddress("ADJUDICATOR_ADDRESS");
        uint256 valueScale = vm.envUint("VALUE_SCALE");

        require(adjudicator != address(0), "ADJUDICATOR_ADDRESS unset");
        require(valueScale != 0, "VALUE_SCALE unset");

        vm.startBroadcast(deployerKey);
        escrow = new ReceiptEscrow(adjudicator, valueScale);
        vm.stopBroadcast();

        console.log("ReceiptEscrow deployed:", address(escrow));
        console.log("adjudicator:          ", adjudicator);
        console.log("valueScale:           ", valueScale);
        console.log("chainid:              ", block.chainid);
    }
}
