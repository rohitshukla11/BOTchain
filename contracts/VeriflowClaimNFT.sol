// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VeriflowClaimNFT
 * @author Veriflow — BOT Chain Builder Challenge #2 (RWA Track)
 * @notice ERC-721 representing real-world asset claims (invoices, royalties,
 *         rentals). Each token encodes structured claim metadata, collateral
 *         state, and originator reputation for on-chain risk management.
 *
 * @dev Architecture overview
 *      ─────────────────────
 *      • Originators (allowlisted addresses) mint claim NFTs via `mintClaim`.
 *      • A stablecoin collateral tranche is locked via `lockCollateral`.
 *        The collateral percentage is determined off-chain / by a RiskOracle
 *        contract (to be integrated in a later phase); this contract simply
 *        accepts the caller-supplied amount as-is.
 *      • Collateral is released to the originator on successful settlement
 *        (`releaseCollateral`) or slashed to the protocol vault on dispute
 *        (`slashCollateral`).
 *      • A simple uint8 reputation score (0–100) tracks originator behaviour
 *        over time and is readable via `getReputation`.
 */
contract VeriflowClaimNFT is ERC721, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Category of the underlying real-world asset claim.
    enum ClaimType {
        Invoice,
        Royalty,
        Rental
    }

    /// @notice All on-chain metadata for a minted claim token.
    struct ClaimData {
        ClaimType claimType;
        /// @dev Face value of the claim in the stablecoin's smallest unit.
        uint256 amount;
        /// @dev Unix timestamp representing the payment due date.
        uint256 dueDate;
        /// @dev Off-chain reference identifying the debtor (hashed / encoded by the originator).
        bytes32 debtorRef;
        /// @dev Address that minted this claim; receives collateral on release.
        address originator;
    }

    /// @notice Collateral state for a single claim token.
    struct CollateralInfo {
        /// @dev Amount of stablecoin locked as collateral.
        uint256 amount;
        /// @dev Whether collateral has been locked for this claim.
        bool locked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Auto-incrementing token ID counter.
    uint256 private _nextTokenId;

    /// @notice ERC-20 stablecoin used for collateral (e.g. USDC on BOT Chain).
    IERC20 public immutable stablecoin;

    /**
     * @notice Address authorised to slash collateral (ArbitratorMultisig in
     *         a later phase; a single settable address for now).
     */
    address public arbitrator;

    /// @notice Protocol vault that receives slashed collateral.
    address public vault;

    /// @notice Allowlist of addresses permitted to mint claim NFTs.
    mapping(address => bool) public allowlistedOriginators;

    /// @notice Claim metadata keyed by token ID.
    mapping(uint256 => ClaimData) public claims;

    /// @notice Collateral state keyed by token ID.
    mapping(uint256 => CollateralInfo) public collateral;

    /**
     * @notice Originator reputation score (0–100).
     *         Starts at 50 for every new originator.
     *         Increments on successful collateral release.
     *         Decrements on collateral slash.
     */
    mapping(address => uint8) public reputationScore;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event ClaimMinted(
        uint256 indexed tokenId,
        address indexed originator,
        ClaimType claimType,
        uint256 amount,
        uint256 dueDate
    );

    event CollateralLocked(
        uint256 indexed tokenId,
        address indexed originator,
        uint256 amount
    );

    event CollateralReleased(
        uint256 indexed tokenId,
        address indexed originator,
        uint256 amount
    );

    event CollateralSlashed(
        uint256 indexed tokenId,
        address indexed originator,
        uint256 amount,
        address indexed vault
    );

    event OriginatorAllowlisted(address indexed originator, bool status);

    event ArbitratorUpdated(address indexed newArbitrator);

    event VaultUpdated(address indexed newVault);

    event ReputationChanged(address indexed originator, uint8 newScore);

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Reverts if caller is not an allowlisted originator.
    modifier onlyAllowlisted() {
        require(allowlistedOriginators[msg.sender], "VeriflowClaimNFT: not allowlisted");
        _;
    }

    /// @dev Reverts if caller is not the configured arbitrator address.
    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "VeriflowClaimNFT: not arbitrator");
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param stablecoin_   Address of the ERC-20 stablecoin used for collateral.
     * @param arbitrator_   Initial arbitrator address (may be updated by owner).
     * @param vault_        Initial vault address for slashed funds (may be updated by owner).
     */
    constructor(address stablecoin_, address arbitrator_, address vault_)
        ERC721("VeriflowClaim", "VFCLAIM")
        Ownable(msg.sender)
    {
        require(stablecoin_ != address(0), "VeriflowClaimNFT: zero stablecoin");
        require(arbitrator_ != address(0), "VeriflowClaimNFT: zero arbitrator");
        require(vault_ != address(0), "VeriflowClaimNFT: zero vault");

        stablecoin = IERC20(stablecoin_);
        arbitrator = arbitrator_;
        vault = vault_;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Owner-only administration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Grant or revoke originator allowlist status.
     * @param originator Address to update.
     * @param status     `true` to allowlist, `false` to remove.
     */
    function setAllowlisted(address originator, bool status) external onlyOwner {
        require(originator != address(0), "VeriflowClaimNFT: zero address");
        allowlistedOriginators[originator] = status;
        emit OriginatorAllowlisted(originator, status);
    }

    /**
     * @notice Update the arbitrator address (future: point to ArbitratorMultisig).
     * @param newArbitrator New arbitrator address.
     */
    function setArbitrator(address newArbitrator) external onlyOwner {
        require(newArbitrator != address(0), "VeriflowClaimNFT: zero arbitrator");
        arbitrator = newArbitrator;
        emit ArbitratorUpdated(newArbitrator);
    }

    /**
     * @notice Update the vault address that receives slashed collateral.
     * @param newVault New vault address.
     */
    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "VeriflowClaimNFT: zero vault");
        vault = newVault;
        emit VaultUpdated(newVault);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core claim lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new claim NFT representing a real-world asset obligation.
     * @dev Only allowlisted originators may call this function. On first mint
     *      the originator's reputation is initialised to 50.
     *
     * @param claimType  Category of the claim (Invoice / Royalty / Rental).
     * @param amount     Face value in stablecoin units.
     * @param dueDate    Unix timestamp for expected settlement.
     * @param debtorRef  Off-chain debtor reference (e.g. keccak256 of debtor ID).
     * @return tokenId   The newly minted token ID.
     */
    function mintClaim(
        ClaimType claimType,
        uint256 amount,
        uint256 dueDate,
        bytes32 debtorRef
    ) external onlyAllowlisted returns (uint256 tokenId) {
        require(amount > 0, "VeriflowClaimNFT: zero amount");
        require(dueDate > block.timestamp, "VeriflowClaimNFT: due date in past");

        // Initialise reputation on first interaction.
        if (reputationScore[msg.sender] == 0) {
            reputationScore[msg.sender] = 50;
        }

        tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        claims[tokenId] = ClaimData({
            claimType: claimType,
            amount: amount,
            dueDate: dueDate,
            debtorRef: debtorRef,
            originator: msg.sender
        });

        emit ClaimMinted(tokenId, msg.sender, claimType, amount, dueDate);
    }

    /**
     * @notice Lock stablecoin collateral against an existing claim.
     *
     * @dev ─────────────────────────────────────────────────────────────────
     *      IMPORTANT: Collateral provides first-loss protection against
     *      fraudulent or disputed claims — it is NOT a repayment guarantee.
     *      ─────────────────────────────────────────────────────────────────
     *
     *      The collateral amount is supplied by the caller. In a later phase
     *      a RiskOracle contract will compute and enforce the required
     *      percentage; for now this function trusts the provided value.
     *
     *      Caller must have pre-approved this contract to spend `amount` of
     *      the stablecoin (ERC-20 `approve` / `permit`).
     *
     * @param claimId Token ID of the claim to collateralise.
     * @param amount  Stablecoin amount to lock (in token's smallest unit).
     */
    function lockCollateral(uint256 claimId, uint256 amount)
        external
        nonReentrant
    {
        ClaimData storage claim = claims[claimId];
        require(claim.originator != address(0), "VeriflowClaimNFT: claim not found");
        require(claim.originator == msg.sender, "VeriflowClaimNFT: not originator");
        require(!collateral[claimId].locked, "VeriflowClaimNFT: collateral already locked");
        require(amount > 0, "VeriflowClaimNFT: zero collateral");

        collateral[claimId] = CollateralInfo({ amount: amount, locked: true });

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        emit CollateralLocked(claimId, msg.sender, amount);
    }

    /**
     * @notice Release locked collateral back to the originator after
     *         successful claim settlement. Increments originator reputation.
     *
     * @dev Only the originator of the claim may trigger release.
     *
     * @param claimId Token ID whose collateral should be released.
     */
    function releaseCollateral(uint256 claimId) external nonReentrant {
        ClaimData storage claim = claims[claimId];
        require(claim.originator != address(0), "VeriflowClaimNFT: claim not found");
        require(
            claim.originator == msg.sender || msg.sender == arbitrator,
            "VeriflowClaimNFT: not originator or arbitrator"
        );
        require(collateral[claimId].locked, "VeriflowClaimNFT: no collateral locked");

        uint256 amount = collateral[claimId].amount;
        address recipient = claim.originator;
        collateral[claimId] = CollateralInfo({ amount: 0, locked: false });

        // Increment reputation, capped at 100.
        _incrementReputation(recipient);

        stablecoin.safeTransfer(recipient, amount);

        emit CollateralReleased(claimId, recipient, amount);
    }

    /**
     * @notice Slash locked collateral to the protocol vault. Restricted to
     *         the configured arbitrator address (future: ArbitratorMultisig).
     *         Decrements originator reputation.
     *
     * @param claimId Token ID whose collateral should be slashed.
     */
    function slashCollateral(uint256 claimId) external nonReentrant onlyArbitrator {
        ClaimData storage claim = claims[claimId];
        require(claim.originator != address(0), "VeriflowClaimNFT: claim not found");
        require(collateral[claimId].locked, "VeriflowClaimNFT: no collateral locked");

        uint256 amount = collateral[claimId].amount;
        address originator = claim.originator;
        address vaultAddr = vault;

        collateral[claimId] = CollateralInfo({ amount: 0, locked: false });

        // Decrement reputation, floored at 0.
        _decrementReputation(originator);

        stablecoin.safeTransfer(vaultAddr, amount);

        emit CollateralSlashed(claimId, originator, amount, vaultAddr);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reputation view
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the reputation score for an originator.
     * @param originator Address to query.
     * @return score     Value in range [0, 100]; 0 means never interacted.
     */
    function getReputation(address originator) external view returns (uint8 score) {
        return reputationScore[originator];
    }

    /// @notice Total number of claim NFTs minted so far.
    ///         Token IDs run from 0 to totalClaims()-1.
    function totalClaims() external view returns (uint256) {
        return _nextTokenId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Increment originator reputation by 1, capped at 100.
    function _incrementReputation(address originator) internal {
        uint8 current = reputationScore[originator];
        if (current < 100) {
            reputationScore[originator] = current + 1;
            emit ReputationChanged(originator, current + 1);
        }
    }

    /// @dev Decrement originator reputation by 1, floored at 0.
    function _decrementReputation(address originator) internal {
        uint8 current = reputationScore[originator];
        if (current > 0) {
            reputationScore[originator] = current - 1;
            emit ReputationChanged(originator, current - 1);
        }
    }
}
