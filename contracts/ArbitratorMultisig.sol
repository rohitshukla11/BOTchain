// SPDX-License-Identifier: MIT
// Contract name retained as ArbitratorMultisig for deployment continuity — product is branded as CredFi.
pragma solidity ^0.8.24;

interface IVeriflowClaimNFT {
    function claims(uint256 claimId)
        external
        view
        returns (
            uint8 claimType,
            uint256 amount,
            uint256 dueDate,
            bytes32 debtorRef,
            address originator
        );

    function collateral(uint256 claimId) external view returns (uint256 amount, bool locked);
    function releaseCollateral(uint256 claimId) external;
    function slashCollateral(uint256 claimId) external;
}

interface IVeriflowClaimVault {
    function funding(uint256 claimId)
        external
        view
        returns (
            address investor,
            uint256 fundedAmount,
            bool funded,
            bool evidenced,
            bytes32 evidenceHash,
            uint256 repaymentAmount,
            bool repaymentDeposited,
            uint256 fundedAt,
            bool disputed,
            bytes32 disputeEvidenceHash
        );

    function distributeToInvestors(uint256 claimId) external;
    function slashToInvestors(address recipient, uint256 amount) external;
}

/**
 * @title ArbitratorMultisig
 * @notice 2-of-3 multisig for claim-scoped dispute resolution.
 */
contract ArbitratorMultisig {
    uint256 public constant QUORUM = 2;
    uint256 public constant MAX_OWNERS = 3;

    mapping(address => bool) public isOwner;
    address[] public owners;
    address public claimNFT;
    address public claimVault;

    struct ClaimResolution {
        uint256 approvals;
        uint256 rejections;
        bool resolved;
        mapping(address => bool) voted;
    }

    mapping(uint256 => ClaimResolution) public claimResolutions;

    event OwnerAdded(address indexed owner);
    event ClaimVoteCasted(uint256 indexed claimId, address indexed voter, bool approved);
    event ClaimResolved(uint256 indexed claimId, bool approved, address indexed resolver);
    event ClaimNFTUpdated(address indexed newClaimNFT);
    event ClaimVaultUpdated(address indexed newClaimVault);

    error ZeroAddress();
    error DuplicateOwner();
    error InvalidOwner();
    error NotOwner();
    error AlreadyVoted();
    error DisputeAlreadyResolved();
    error QuorumNotReached();
    error ClaimNotFound();

    constructor(address[3] memory initialOwners) {
        for (uint256 i = 0; i < initialOwners.length; i++) {
            address owner = initialOwners[i];
            if (owner == address(0)) revert ZeroAddress();
            if (isOwner[owner]) revert DuplicateOwner();
            isOwner[owner] = true;
            owners.push(owner);
            emit OwnerAdded(owner);
        }

        if (owners.length != MAX_OWNERS) revert InvalidOwner();
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    function ownersList() external view returns (address[] memory) {
        return owners;
    }

    /// @notice Returns whether a specific owner has already voted on a claim.
    ///         The nested `voted` mapping is excluded from the auto-generated
    ///         claimResolutions() getter, so this explicit view is required.
    function hasVoted(uint256 claimId, address voter) external view returns (bool) {
        return claimResolutions[claimId].voted[voter];
    }

    function setClaimNFT(address newClaimNFT) external onlyOwner {
        if (newClaimNFT == address(0)) revert ZeroAddress();
        claimNFT = newClaimNFT;
        emit ClaimNFTUpdated(newClaimNFT);
    }

    function setClaimVault(address newClaimVault) external onlyOwner {
        if (newClaimVault == address(0)) revert ZeroAddress();
        claimVault = newClaimVault;
        emit ClaimVaultUpdated(newClaimVault);
    }

    function voteDispute(uint256 claimId, bool approved) external onlyOwner {
        ClaimResolution storage resolution = claimResolutions[claimId];
        if (resolution.resolved) revert DisputeAlreadyResolved();
        if (resolution.voted[msg.sender]) revert AlreadyVoted();

        resolution.voted[msg.sender] = true;

        if (approved) {
            resolution.approvals += 1;
        } else {
            resolution.rejections += 1;
        }

        emit ClaimVoteCasted(claimId, msg.sender, approved);
    }

    function resolveDispute(uint256 claimId, bool approved) external onlyOwner {
        ClaimResolution storage resolution = claimResolutions[claimId];
        if (resolution.resolved) revert DisputeAlreadyResolved();

        uint256 tally = approved ? resolution.approvals : resolution.rejections;
        if (tally < QUORUM) revert QuorumNotReached();

        if (claimNFT == address(0) || claimVault == address(0)) revert ZeroAddress();

        IVeriflowClaimNFT nft = IVeriflowClaimNFT(claimNFT);
        IVeriflowClaimVault vault = IVeriflowClaimVault(claimVault);

        (, , , , address originator) = nft.claims(claimId);
        if (originator == address(0)) revert ClaimNotFound();

        if (approved) {
            (uint256 collateralAmount, bool locked) = nft.collateral(claimId);
            if (locked && collateralAmount > 0) nft.releaseCollateral(claimId);
            vault.distributeToInvestors(claimId);
        } else {
            (uint256 collateralAmount, bool locked) = nft.collateral(claimId);
            if (locked && collateralAmount > 0) {
                nft.slashCollateral(claimId);

                (address investor, uint256 fundedAmount, bool funded, , , , , , , ) = vault.funding(claimId);
                if (funded && fundedAmount > 0 && investor != address(0)) {
                    vault.slashToInvestors(investor, collateralAmount);
                }
            }
        }

        resolution.resolved = true;
        emit ClaimResolved(claimId, approved, msg.sender);
    }
}
