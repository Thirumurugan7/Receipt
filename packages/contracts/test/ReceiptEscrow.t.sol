// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptEscrow} from "../src/ReceiptEscrow.sol";

/// Re-enters claimExpired() while receiving a release payout. If the escrow
/// does not write status before transferring, this drains the deal twice.
contract ReentrantPayee {
    ReceiptEscrow public escrow;
    bytes32 public dealId;
    uint256 public received;
    bool public reentered;

    function arm(ReceiptEscrow e, bytes32 id) external { escrow = e; dealId = id; }

    receive() external payable {
        received += msg.value;
        if (!reentered) {
            reentered = true;
            try escrow.claimExpired(dealId) {} catch {}
        }
    }
}

contract ReceiptEscrowTest is Test {
    ReceiptEscrow escrow;

    uint256 constant PAYER_PK = 0xA11CE;
    uint256 constant OTHER_PK = 0xB0B;
    uint256 constant VALUE_SCALE = 1e10; // Hedera tinybar -> weibar

    address payer;
    address payee = address(0xBEEF);
    address adjudicator = address(0xAD1);
    address owner = address(this);
    address stranger = address(0x5747A);

    uint256 constant AMOUNT_TINYBARS = 10_000;
    uint256 constant AMOUNT_WEIBARS = AMOUNT_TINYBARS * VALUE_SCALE;
    bytes32 constant TERMS_HASH = keccak256("terms");
    bytes32 constant VERDICT_HASH = keccak256("verdict");
    bytes32 constant NONCE = bytes32(uint256(1));

    uint64 deadline;

    function setUp() public {
        payer = vm.addr(PAYER_PK);
        escrow = new ReceiptEscrow(adjudicator, VALUE_SCALE);
        deadline = uint64(block.timestamp + 60);
        vm.deal(address(this), 100 ether);
    }

    // ---- EIP-712, reimplemented independently of the contract ----

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Receipt")),
                keccak256(bytes("1")),
                block.chainid,
                address(escrow)
            )
        );
    }

    function _digest(address p, address pe, uint256 amt, bytes32 th, uint64 dl, bytes32 n)
        internal view returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Terms(bytes32 termsHash,address payer,address payee,uint256 amount,uint64 deadline,bytes32 nonce)"),
                th, p, pe, amt, dl, n
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _sign(uint256 pk, address p, address pe, uint256 amt, bytes32 th, uint64 dl, bytes32 n)
        internal view returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(p, pe, amt, th, dl, n));
        return abi.encodePacked(r, s, v);
    }

    function _open() internal returns (bytes32 id) {
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        escrow.open{value: AMOUNT_WEIBARS}(payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);
        return escrow.computeDealId(payer, payee, NONCE);
    }

    // ---- open ----

    function test_open_escrowsFundsAndRecordsTheDeal() public {
        bytes32 id = _open();
        (address p, address pe, uint256 amt, bytes32 th,, uint64 dl, ReceiptEscrow.Status st) = escrow.deals(id);
        assertEq(p, payer);
        assertEq(pe, payee);
        assertEq(amt, AMOUNT_WEIBARS);
        assertEq(th, TERMS_HASH);
        assertEq(dl, deadline);
        assertEq(uint8(st), uint8(ReceiptEscrow.Status.Open));
        assertEq(address(escrow).balance, AMOUNT_WEIBARS);
    }

    function test_open_revertsOnSecondOpenOfTheSameDeal() public {
        _open();
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        vm.expectRevert(ReceiptEscrow.DealExists.selector);
        escrow.open{value: AMOUNT_WEIBARS}(payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);
    }

    function test_open_revertsWhenSignerIsNotThePayer() public {
        bytes memory sig = _sign(OTHER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        vm.expectRevert(ReceiptEscrow.BadSignature.selector);
        escrow.open{value: AMOUNT_WEIBARS}(payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);
    }

    /// The facilitator holds funds for one hop. This is what stops it profiting.
    function test_open_revertsWhenFacilitatorInflatesTheAmount() public {
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        vm.expectRevert(ReceiptEscrow.BadSignature.selector);
        escrow.open{value: AMOUNT_WEIBARS * 2}(payer, payee, AMOUNT_TINYBARS * 2, TERMS_HASH, deadline, NONCE, sig);
    }

    function test_open_revertsWhenFacilitatorRedirectsThePayee() public {
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        vm.expectRevert(ReceiptEscrow.BadSignature.selector);
        escrow.open{value: AMOUNT_WEIBARS}(payer, address(0xDEAD), AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);
    }

    function test_open_revertsWhenMsgValueDoesNotMatchTheSignedAmount() public {
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiptEscrow.ValueMismatch.selector, AMOUNT_WEIBARS, AMOUNT_WEIBARS - 1)
        );
        escrow.open{value: AMOUNT_WEIBARS - 1}(payer, payee, AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);
    }

    function test_open_revertsOnAPastDeadline() public {
        uint64 past = uint64(block.timestamp - 1);
        bytes memory sig = _sign(PAYER_PK, payer, payee, AMOUNT_TINYBARS, TERMS_HASH, past, NONCE);
        vm.expectRevert(ReceiptEscrow.DeadlineInPast.selector);
        escrow.open{value: AMOUNT_WEIBARS}(payer, payee, AMOUNT_TINYBARS, TERMS_HASH, past, NONCE, sig);
    }

    function test_open_emitsDealOpened() public {
        bytes32 id = escrow.computeDealId(payer, payee, NONCE);
        vm.expectEmit(true, true, true, true);
        emit ReceiptEscrow.DealOpened(id, payer, payee, AMOUNT_WEIBARS, TERMS_HASH, deadline);
        _open();
    }

    // ---- release ----

    function test_release_paysThePayee() public {
        bytes32 id = _open();
        uint256 before = payee.balance;
        vm.prank(adjudicator);
        escrow.release(id, VERDICT_HASH);
        assertEq(payee.balance - before, AMOUNT_WEIBARS);
        (,,,,,, ReceiptEscrow.Status st) = escrow.deals(id);
        assertEq(uint8(st), uint8(ReceiptEscrow.Status.Released));
    }

    function test_release_revertsForNonAdjudicator() public {
        bytes32 id = _open();
        vm.prank(stranger);
        vm.expectRevert(ReceiptEscrow.NotAdjudicator.selector);
        escrow.release(id, VERDICT_HASH);
    }

    function test_release_revertsWhenAlreadySettled() public {
        bytes32 id = _open();
        vm.startPrank(adjudicator);
        escrow.release(id, VERDICT_HASH);
        vm.expectRevert(ReceiptEscrow.DealNotOpen.selector);
        escrow.release(id, VERDICT_HASH);
        vm.stopPrank();
    }

    // ---- refund ----

    function test_refund_returnsFundsToThePayer() public {
        bytes32 id = _open();
        uint256 before = payer.balance;
        vm.prank(adjudicator);
        escrow.refund(id, VERDICT_HASH, "jsonSchema");
        assertEq(payer.balance - before, AMOUNT_WEIBARS);
        (,,,,,, ReceiptEscrow.Status st) = escrow.deals(id);
        assertEq(uint8(st), uint8(ReceiptEscrow.Status.Refunded));
    }

    function test_refund_revertsForNonAdjudicator() public {
        bytes32 id = _open();
        vm.prank(stranger);
        vm.expectRevert(ReceiptEscrow.NotAdjudicator.selector);
        escrow.refund(id, VERDICT_HASH, "nope");
    }

    function test_refund_emitsReasonForTheDashboard() public {
        bytes32 id = _open();
        vm.expectEmit(true, false, false, true);
        emit ReceiptEscrow.DealRefunded(id, VERDICT_HASH, "jsonSchema");
        vm.prank(adjudicator);
        escrow.refund(id, VERDICT_HASH, "jsonSchema");
    }

    // ---- claimExpired: the liveness guarantee ----

    function test_claimExpired_revertsBeforeTheDeadline() public {
        bytes32 id = _open();
        vm.expectRevert(ReceiptEscrow.NotYetExpired.selector);
        escrow.claimExpired(id);
    }

    function test_claimExpired_succeedsAfterTheDeadline() public {
        bytes32 id = _open();
        uint256 before = payer.balance;
        vm.warp(deadline + 1);
        escrow.claimExpired(id);
        assertEq(payer.balance - before, AMOUNT_WEIBARS);
        (,,,,,, ReceiptEscrow.Status st) = escrow.deals(id);
        assertEq(uint8(st), uint8(ReceiptEscrow.Status.Refunded));
    }

    /// A dead seller must not be able to trap funds, and no privileged party
    /// should be needed to free them. Demo scene 4 calls this from a stranger.
    function test_claimExpired_isPermissionless() public {
        bytes32 id = _open();
        uint256 before = payer.balance;
        vm.warp(deadline + 1);
        vm.prank(stranger);
        escrow.claimExpired(id);
        assertEq(payer.balance - before, AMOUNT_WEIBARS);
    }

    function test_claimExpired_revertsOnAnAlreadySettledDeal() public {
        bytes32 id = _open();
        vm.prank(adjudicator);
        escrow.release(id, VERDICT_HASH);
        vm.warp(deadline + 1);
        vm.expectRevert(ReceiptEscrow.DealNotOpen.selector);
        escrow.claimExpired(id);
    }

    // ---- reentrancy ----

    function test_release_isNotDrainedByAReentrantPayee() public {
        ReentrantPayee attacker = new ReentrantPayee();
        bytes32 id = escrow.computeDealId(payer, address(attacker), NONCE);
        attacker.arm(escrow, id);

        bytes memory sig = _sign(PAYER_PK, payer, address(attacker), AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE);
        escrow.open{value: AMOUNT_WEIBARS}(payer, address(attacker), AMOUNT_TINYBARS, TERMS_HASH, deadline, NONCE, sig);

        vm.warp(deadline + 1);
        vm.prank(adjudicator);
        escrow.release(id, VERDICT_HASH);

        assertTrue(attacker.reentered(), "attacker did not attempt reentry");
        assertEq(attacker.received(), AMOUNT_WEIBARS, "paid more than once");
        assertEq(address(escrow).balance, 0);
    }

    // ---- admin ----

    function test_setAdjudicator_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        escrow.setAdjudicator(stranger);
    }

    function test_setAdjudicator_rotatesTheKey() public {
        escrow.setAdjudicator(stranger);
        assertEq(escrow.adjudicator(), stranger);
        bytes32 id = _open();
        vm.prank(stranger);
        escrow.release(id, VERDICT_HASH);
    }
}
