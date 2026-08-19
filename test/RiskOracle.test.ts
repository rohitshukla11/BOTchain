import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const enum ClaimType {
  Invoice = 0,
  Royalty = 1,
  Rental = 2,
}

describe("RiskOracle", () => {
  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();
    const RiskOracleFactory = await ethers.getContractFactory("RiskOracle");
    const oracle = await RiskOracleFactory.deploy();
    return { oracle, owner, stranger };
  }

  it("uses default collateral ratios for each claim type", async () => {
    const { oracle } = await deployFixture();

    expect(await oracle.collateralRatioBps(ClaimType.Invoice)).to.equal(1000n);
    expect(await oracle.collateralRatioBps(ClaimType.Royalty)).to.equal(1500n);
    expect(await oracle.collateralRatioBps(ClaimType.Rental)).to.equal(2000n);
  });

  it("calculates required collateral from a claim amount", async () => {
    const { oracle } = await deployFixture();
    const claimAmount = ethers.parseUnits("10000", 18);

    expect(await oracle.getRequiredCollateral(ClaimType.Invoice, claimAmount)).to.equal(
      ethers.parseUnits("1000", 18),
    );
    expect(await oracle.getRequiredCollateral(ClaimType.Royalty, claimAmount)).to.equal(
      ethers.parseUnits("1500", 18),
    );
    expect(await oracle.getRequiredCollateral(ClaimType.Rental, claimAmount)).to.equal(
      ethers.parseUnits("2000", 18),
    );
  });

  it("allows owner to update collateral ratio", async () => {
    const { oracle, owner } = await deployFixture();
    await expect(oracle.connect(owner).setCollateralRatio(ClaimType.Invoice, 2500n))
      .to.emit(oracle, "CollateralRatioUpdated")
      .withArgs(ClaimType.Invoice, 2500n);

    expect(await oracle.collateralRatioBps(ClaimType.Invoice)).to.equal(2500n);
  });

  it("rejects non-owner updates", async () => {
    const { oracle, stranger } = await deployFixture();
    await expect(
      oracle.connect(stranger).setCollateralRatio(ClaimType.Invoice, 2500n),
    ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
  });
});
