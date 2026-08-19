// SPDX-License-Identifier: MIT
// Contract name retained as VeriflowClaimVault for deployment continuity — product is branded as CredFi.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
}

interface IRiskOracle {
    function getRequiredCollateral(uint8 claimType, uint256 claimAmount) external view returns (uint256 requiredCollateral);
}

/**
 * @title VeriflowClaimVault
 * @notice Treasury contract that owns all investor-funding, evidence, challenge-window,
 *         and distribution logic for claim flows. ClaimNFT is limited to identity and collateral.
 */
contract VeriflowClaimVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant YIELD_BPS = 1000; // 10% fixed yield for the hackathon flow.

    struct ClaimFunding {
        address investor;
        uint256 fundedAmount;
        bool funded;
        bool evidenced;
        bytes32 evidenceHash;
        uint256 repaymentAmount;
        bool repaymentDeposited;
        uint256 fundedAt;
        bool disputed;
        bytes32 disputeEvidenceHash;
    }

    IERC20 public immutable stablecoin;
    address public arbitrator;
    address public vault;
    address public claimNFT;
    address public riskOracle;
    uint256 public challengeWindow;

    mapping(uint256 => ClaimFunding) public funding;

    event ArbitratorUpdated(address indexed newArbitrator);
    event VaultUpdated(address indexed newVault);
    event ClaimNFTUpdated(address indexed claimNFT);
    event RiskOracleUpdated(address indexed riskOracle);
    event ChallengeWindowUpdated(uint256 newChallengeWindow);
    event FundingDeposited(uint256 indexed claimId, address indexed investor, uint256 amount);
    event RepaymentEvidenceSubmitted(uint256 indexed claimId, bytes32 evidenceHash);
    event RepaymentDeposited(uint256 indexed claimId, uint256 amount);
    event DisputeRaised(uint256 indexed claimId, bytes32 evidenceHash);
    event DistributionMade(uint256 indexed claimId, address indexed investor, uint256 amount);
    event OriginatorReleased(address indexed recipient, uint256 amount);
    event InvestorsSlashed(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error NotArbitrator();
    error ClaimNotFound();
    error AlreadyFunded();
    error InvalidEvidence();
    error ChallengeWindowActive();
    error AlreadyDisputed();
    error RiskOracleNotSet();
    error FundingAboveCap();

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator();
        _;
    }

    constructor(address stablecoin_, address arbitrator_, address vault_, uint256 challengeWindow_)
        Ownable(msg.sender)
    {
        if (stablecoin_ == address(0)) revert ZeroAddress();
        if (arbitrator_ == address(0)) revert ZeroAddress();
        if (vault_ == address(0)) revert ZeroAddress();
        if (challengeWindow_ == 0) revert ZeroAddress();

        stablecoin = IERC20(stablecoin_);
        arbitrator = arbitrator_;
        vault = vault_;
        challengeWindow = challengeWindow_;
    }

    function setArbitrator(address newArbitrator) external onlyOwner {
        if (newArbitrator == address(0)) revert ZeroAddress();
        arbitrator = newArbitrator;
        emit ArbitratorUpdated(newArbitrator);
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        vault = newVault;
        emit VaultUpdated(newVault);
    }

    function setClaimNFT(address newClaimNFT) external onlyOwner {
        if (newClaimNFT == address(0)) revert ZeroAddress();
        claimNFT = newClaimNFT;
        emit ClaimNFTUpdated(newClaimNFT);
    }

    function setRiskOracle(address newRiskOracle) external onlyOwner {
        if (newRiskOracle == address(0)) revert ZeroAddress();
        riskOracle = newRiskOracle;
        emit RiskOracleUpdated(newRiskOracle);
    }

    function setChallengeWindow(uint256 newChallengeWindow) external onlyOwner {
        if (newChallengeWindow == 0) revert ZeroAddress();
        challengeWindow = newChallengeWindow;
        emit ChallengeWindowUpdated(newChallengeWindow);
    }

    function fundClaim(uint256 claimId, uint256 amount) external nonReentrant {
        require(amount > 0, "VeriflowClaimVault: zero funding");
        require(!funding[claimId].funded, "VeriflowClaimVault: already funded");

        if (claimNFT == address(0)) revert ClaimNotFound();
        (uint8 claimType, uint256 claimAmount, , , address originator) = IVeriflowClaimNFT(claimNFT).claims(claimId);
        if (originator == address(0)) revert ClaimNotFound();

        if (riskOracle == address(0)) revert RiskOracleNotSet();

        uint256 requiredCollateral = IRiskOracle(riskOracle).getRequiredCollateral(claimType, claimAmount);
        uint256 maxFundingAmount = claimAmount - requiredCollateral;
        if (amount > maxFundingAmount) revert FundingAboveCap();

        funding[claimId] = ClaimFunding({
            investor: msg.sender,
            fundedAmount: amount,
            funded: true,
            evidenced: false,
            evidenceHash: bytes32(0),
            repaymentAmount: 0,
            repaymentDeposited: false,
            fundedAt: block.timestamp,
            disputed: false,
            disputeEvidenceHash: bytes32(0)
        });

        // Cash-now flow: the investor funds the originator immediately.
        stablecoin.safeTransferFrom(msg.sender, originator, amount);
        emit FundingDeposited(claimId, msg.sender, amount);
    }

    function submitRepaymentEvidence(uint256 claimId, bytes32 evidenceHash) external {
        if (claimNFT == address(0)) revert ClaimNotFound();
        (, , , , address originator) = IVeriflowClaimNFT(claimNFT).claims(claimId);
        if (originator == address(0)) revert ClaimNotFound();
        if (msg.sender != originator) revert InvalidEvidence();
        require(funding[claimId].funded, "VeriflowClaimVault: not funded");
        require(!funding[claimId].evidenced, "VeriflowClaimVault: evidence already submitted");

        funding[claimId].evidenceHash = evidenceHash;
        funding[claimId].evidenced = true;
        emit RepaymentEvidenceSubmitted(claimId, evidenceHash);
    }

    function depositRepayment(uint256 claimId, uint256 amount) external nonReentrant {
        if (claimNFT == address(0)) revert ClaimNotFound();
        (, , , , address originator) = IVeriflowClaimNFT(claimNFT).claims(claimId);
        if (originator == address(0)) revert ClaimNotFound();
        if (msg.sender != originator) revert InvalidEvidence();
        require(funding[claimId].funded, "VeriflowClaimVault: not funded");
        require(!funding[claimId].repaymentDeposited, "VeriflowClaimVault: repayment already deposited");
        require(amount > 0, "VeriflowClaimVault: zero repayment");

        uint256 requiredRepayment = funding[claimId].fundedAmount + (funding[claimId].fundedAmount * YIELD_BPS / 10_000);
        require(amount >= requiredRepayment, "VeriflowClaimVault: repayment below required principal + yield");

        funding[claimId].repaymentAmount = amount;
        funding[claimId].repaymentDeposited = true;
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        emit RepaymentDeposited(claimId, amount);
    }

    function raiseDispute(uint256 claimId, bytes32 disputeEvidenceHash) external {
        require(funding[claimId].funded, "VeriflowClaimVault: not funded");
        require(!funding[claimId].repaymentDeposited, "VeriflowClaimVault: repayment already settled");
        require(msg.sender == funding[claimId].investor, "VeriflowClaimVault: not investor");
        require(!funding[claimId].disputed, "VeriflowClaimVault: already disputed");

        funding[claimId].disputed = true;
        funding[claimId].disputeEvidenceHash = disputeEvidenceHash;
        emit DisputeRaised(claimId, disputeEvidenceHash);
    }

    function distributeToInvestors(uint256 claimId) external nonReentrant {
        require(funding[claimId].funded, "VeriflowClaimVault: not funded");
        require(block.timestamp >= funding[claimId].fundedAt + challengeWindow, "VeriflowClaimVault: challenge window active");
        require(!funding[claimId].disputed, "VeriflowClaimVault: claim disputed");
        require(funding[claimId].repaymentDeposited, "VeriflowClaimVault: repayment not deposited");

        uint256 amount = funding[claimId].repaymentAmount;
        address investor = funding[claimId].investor;

        funding[claimId].funded = false;
        funding[claimId].repaymentAmount = 0;
        stablecoin.safeTransfer(investor, amount);
        emit DistributionMade(claimId, investor, amount);
    }

    function releaseToOriginator(uint256 claimId) external onlyArbitrator nonReentrant {
        if (claimNFT == address(0)) revert ClaimNotFound();

        (, , , , address recipient) = IVeriflowClaimNFT(claimNFT).claims(claimId);
        if (recipient == address(0)) revert ClaimNotFound();

        (uint256 amount, bool locked) = IVeriflowClaimNFT(claimNFT).collateral(claimId);
        if (!locked || amount == 0) revert ClaimNotFound();

        stablecoin.safeTransfer(recipient, amount);
        emit OriginatorReleased(recipient, amount);
    }

    function slashToInvestors(address recipient, uint256 amount) external onlyArbitrator nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        stablecoin.safeTransfer(recipient, amount);
        emit InvestorsSlashed(recipient, amount);
    }
}
