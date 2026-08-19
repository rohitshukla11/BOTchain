// SPDX-License-Identifier: MIT
// Contract name retained as RiskOracle for deployment continuity — product is branded as CredFi.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RiskOracle
 * @notice Provides per-claim-type collateral ratios used by Veriflow risk assessments.
 * @dev This contract is intentionally lightweight for the first iteration. It stores
 *      the collateral ratios in basis points and exposes a pure calculation helper.
 */
contract RiskOracle is Ownable {
    enum ClaimType {
        Invoice,
        Royalty,
        Rental
    }

    /// @notice Basis point collateral requirement per claim type.
    /// @dev 1000 bps = 10%, 1500 = 15%, 2000 = 20%
    mapping(ClaimType => uint16) public collateralRatioBps;

    event CollateralRatioUpdated(ClaimType indexed claimType, uint16 newRatioBps);

    constructor() Ownable(msg.sender) {
        collateralRatioBps[ClaimType.Invoice] = 1000;
        collateralRatioBps[ClaimType.Royalty] = 1500;
        collateralRatioBps[ClaimType.Rental] = 2000;
    }

    /// @notice Update the collateral ratio for a given claim type.
    /// @param claimType The underlying claim category.
    /// @param ratioBps The new requirement in basis points.
    function setCollateralRatio(ClaimType claimType, uint16 ratioBps) external onlyOwner {
        collateralRatioBps[claimType] = ratioBps;
        emit CollateralRatioUpdated(claimType, ratioBps);
    }

    /// @notice Compute the collateral required for a claim amount.
    /// @param claimType The underlying claim category.
    /// @param claimAmount Face value of the claim in base units.
    /// @return requiredCollateral The required collateral in the same unit as claimAmount.
    function getRequiredCollateral(ClaimType claimType, uint256 claimAmount)
        external
        view
        returns (uint256 requiredCollateral)
    {
        uint16 ratio = collateralRatioBps[claimType];
        return (claimAmount * ratio) / 10_000;
    }
}
