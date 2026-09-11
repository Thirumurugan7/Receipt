// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ReceiptEscrow
 * @notice Conditional settlement for x402. Payment sits here until a
 *         deterministic adjudicator publishes a verdict over the seller's
 *         response, then it moves to the seller or back to the buyer.
 *
 * @dev VALUE DENOMINATION. This contract holds the chain's NATIVE asset.
 *      On Hedera that is HBAR, and there are two different units for it:
 *        - the native ledger (and x402 `amount`) counts TINYBARS, 1e8 per HBAR
 *        - the EVM `msg.value` counts WEIBARS,            1e18 per HBAR
 *      so `valueScale` is 1e10 on Hedera. On a plain EVM chain where the
 *      signed amount is already wei, deploy with valueScale = 1. Keeping the
 *      factor in an immutable is what lets the same bytecode back the Base
 *      Sepolia fallback without editing the contract.
 *
 * @dev TRUST MODEL. The facilitator receives the x402 payment natively and
 *      forwards it here in the same request, so it custodies for one hop.
 *      `open` therefore verifies the buyer's EIP-712 signature over the deal
 *      terms: the facilitator cannot open a deal the buyer did not sign, nor
 *      alter the amount, payee, deadline or terms on the way through. After
 *      `open`, only the adjudicator moves funds, and only to the two addresses
 *      the buyer signed for. `claimExpired` needs nobody at all.
 */
contract ReceiptEscrow is EIP712, Ownable, ReentrancyGuard {
    enum Status {
        None,
        Open,
        Released,
        Refunded
    }

    struct Deal {
        address payer;
        address payee;
        uint256 amountWeibars;
        bytes32 termsHash;
        uint64 openedAt;
        uint64 deadline;
        Status status;
    }

    bytes32 private constant TERMS_TYPEHASH = keccak256(
        "Terms(bytes32 termsHash,address payer,address payee,uint256 amount,uint64 deadline,bytes32 nonce)"
    );

    mapping(bytes32 => Deal) public deals;
    address public adjudicator;

    /// @notice Weibars per unit of the signed `amount`. 1e10 on Hedera, 1 elsewhere.
    uint256 public immutable valueScale;

    event DealOpened(
        bytes32 indexed dealId,
        address indexed payer,
        address indexed payee,
        uint256 amountWeibars,
        bytes32 termsHash,
        uint64 deadline
    );
    event DealReleased(bytes32 indexed dealId, bytes32 verdictHash);
    event DealRefunded(bytes32 indexed dealId, bytes32 verdictHash, string reason);
    event DealExpired(bytes32 indexed dealId);
    event AdjudicatorChanged(address indexed previous, address indexed next);

    error NotAdjudicator();
    error DealExists();
    error DealNotOpen();
    error BadSignature();
    error ValueMismatch(uint256 expected, uint256 received);
    error DeadlineInPast();
    error NotYetExpired();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyAdjudicator() {
        if (msg.sender != adjudicator) revert NotAdjudicator();
        _;
    }

    constructor(address adjudicator_, uint256 valueScale_)
        EIP712("Receipt", "1")
        Ownable(msg.sender)
    {
        if (adjudicator_ == address(0)) revert ZeroAddress();
        adjudicator = adjudicator_;
        valueScale = valueScale_;
        emit AdjudicatorChanged(address(0), adjudicator_);
    }

    /// @notice Deal key. Derived, never supplied, so a caller cannot file a
    ///         deal under an id that does not match its own parties.
    function computeDealId(address payer, address payee, bytes32 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, payee, nonce));
    }

    /// @notice The exact digest a buyer signs for these deal parameters.
    /// @dev Public so a buyer can confirm what it is signing, a verifier can
    ///      re-derive it, and the TypeScript client can be pinned to it.
    function termsDigest(
        bytes32 termsHash,
        address payer,
        address payee,
        uint256 amount,
        uint64 deadline,
        bytes32 nonce
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(TERMS_TYPEHASH, termsHash, payer, payee, amount, deadline, nonce))
        );
    }

    /// @notice The EIP-712 struct type hash this contract verifies against.
    function termsTypeHash() external pure returns (bytes32) {
        return TERMS_TYPEHASH;
    }

    /**
     * @notice Escrow a payment against buyer-signed terms.
     * @param amount The amount as signed by the buyer, in x402 units (tinybars
     *        on Hedera). `msg.value` must equal `amount * valueScale`.
     * @param signature Buyer's EIP-712 signature over the Terms struct.
     */
    function open(
        address payer,
        address payee,
        uint256 amount,
        bytes32 termsHash,
        uint64 deadline,
        bytes32 nonce,
        bytes calldata signature
    ) external payable nonReentrant returns (bytes32 dealId) {
        if (payer == address(0) || payee == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        uint256 expected = amount * valueScale;
        if (msg.value != expected) revert ValueMismatch(expected, msg.value);

        bytes32 digest = termsDigest(termsHash, payer, payee, amount, deadline, nonce);
        if (ECDSA.recover(digest, signature) != payer) revert BadSignature();

        dealId = computeDealId(payer, payee, nonce);
        if (deals[dealId].status != Status.None) revert DealExists();

        deals[dealId] = Deal({
            payer: payer,
            payee: payee,
            amountWeibars: msg.value,
            termsHash: termsHash,
            openedAt: uint64(block.timestamp),
            deadline: deadline,
            status: Status.Open
        });

        emit DealOpened(dealId, payer, payee, msg.value, termsHash, deadline);
    }

    /// @notice Verdict passed: pay the seller.
    function release(bytes32 dealId, bytes32 verdictHash) external onlyAdjudicator nonReentrant {
        Deal storage d = deals[dealId];
        if (d.status != Status.Open) revert DealNotOpen();
        d.status = Status.Released;
        emit DealReleased(dealId, verdictHash);
        _send(d.payee, d.amountWeibars);
    }

    /// @notice Verdict failed: return the buyer's money.
    function refund(bytes32 dealId, bytes32 verdictHash, string calldata reason)
        external
        onlyAdjudicator
        nonReentrant
    {
        Deal storage d = deals[dealId];
        if (d.status != Status.Open) revert DealNotOpen();
        d.status = Status.Refunded;
        emit DealRefunded(dealId, verdictHash, reason);
        _send(d.payer, d.amountWeibars);
    }

    /**
     * @notice Permissionless refund once the deadline passes.
     * @dev The liveness guarantee. A seller that never responds, an adjudicator
     *      that goes offline, or a facilitator that walks away cannot trap the
     *      buyer's funds: anyone at all can call this and the money can only go
     *      back to the payer.
     */
    function claimExpired(bytes32 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        if (d.status != Status.Open) revert DealNotOpen();
        if (block.timestamp <= d.deadline) revert NotYetExpired();
        d.status = Status.Refunded;
        emit DealExpired(dealId);
        emit DealRefunded(dealId, bytes32(0), "expired");
        _send(d.payer, d.amountWeibars);
    }

    function setAdjudicator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AdjudicatorChanged(adjudicator, next);
        adjudicator = next;
    }

    /// @dev Status is always written before this is called (checks-effects-interactions).
    function _send(address to, uint256 amountWeibars) private {
        (bool sent,) = payable(to).call{value: amountWeibars}("");
        if (!sent) revert TransferFailed();
    }
}
