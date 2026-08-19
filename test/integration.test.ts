import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const enum ClaimType {
  Invoice = 0,
  Royalty = 1,
  Rental = 2,
}

const COLLATERAL = ethers.parseUnits("500", 18);
const CLAIM_AMOUNT = ethers.parseUnits("10000", 18);

async function futureDueDate(): Promise<bigint> {
  const latest = await ethers.provider.getBlock("latest");
  return BigInt(latest!.timestamp) + 60n * 60n * 24n * 30n;
}

describe("Veriflow integration", () => {
  it("happy path: vault owns claim funding and challenge distribution", async () => {
    const [deployer, originator, investorA, investorB, investorC] = await ethers.getSigners();

    const MockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
    const stablecoin = await MockStablecoinFactory.deploy();

    const RiskOracleFactory = await ethers.getContractFactory("RiskOracle");
    const riskOracle = await RiskOracleFactory.deploy();

    const ArbitratorMultisigFactory = await ethers.getContractFactory("ArbitratorMultisig");
    const arbitratorMultisig = await ArbitratorMultisigFactory.deploy([
      investorA.address,
      investorB.address,
      investorC.address,
    ]);

    const VeriflowClaimVaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
    const vault = await VeriflowClaimVaultFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      investorC.address,
      1n,
    );

    const VeriflowClaimNFTFactory = await ethers.getContractFactory("VeriflowClaimNFT");
    const nft = await VeriflowClaimNFTFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      await vault.getAddress(),
    );

    await nft.connect(deployer).setAllowlisted(originator.address, true);
    await nft.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await nft.connect(deployer).setVault(await vault.getAddress());
    await vault.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await vault.connect(deployer).setVault(investorC.address);
    await vault.connect(deployer).setClaimNFT(await nft.getAddress());
    await vault.connect(deployer).setRiskOracle(await riskOracle.getAddress());

    await stablecoin.mint(originator.address, ethers.parseUnits("500000", 18));
    await stablecoin.mint(investorA.address, ethers.parseUnits("500000", 18));
    await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(originator).approve(await vault.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(investorA).approve(await vault.getAddress(), ethers.MaxUint256);

    const dueDate = await futureDueDate();
    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, dueDate, ethers.ZeroHash);

    const requiredCollateral = await riskOracle.getRequiredCollateral(ClaimType.Invoice, CLAIM_AMOUNT);
    expect(requiredCollateral).to.equal(ethers.parseUnits("1000", 18));

    await nft.connect(originator).lockCollateral(0n, requiredCollateral);

    const maxFunding = CLAIM_AMOUNT - requiredCollateral;
    const originatorBalanceBeforeFund = await stablecoin.balanceOf(originator.address);
    await vault.connect(investorA).fundClaim(0n, maxFunding);
    const funding = await vault.funding(0n);
    expect(funding.funded).to.equal(true);
    expect(funding.investor).to.equal(investorA.address);
    expect(await stablecoin.balanceOf(originator.address)).to.equal(originatorBalanceBeforeFund + maxFunding);
    expect(await stablecoin.balanceOf(await vault.getAddress())).to.equal(0n);

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("repayment-proof-001"));
    await vault.connect(originator).submitRepaymentEvidence(0n, evidenceHash);
    const repaymentAmount = maxFunding + (maxFunding * 10n / 100n);
    await vault.connect(originator).depositRepayment(0n, repaymentAmount);
    expect(await stablecoin.balanceOf(await vault.getAddress())).to.equal(repaymentAmount);

    await arbitratorMultisig.connect(investorA).setClaimNFT(await nft.getAddress());
    await arbitratorMultisig.connect(investorA).setClaimVault(await vault.getAddress());

    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    const investorBalanceBeforeDistribute = await stablecoin.balanceOf(investorA.address);
    await arbitratorMultisig.connect(investorA).voteDispute(0n, true);
    await arbitratorMultisig.connect(investorB).voteDispute(0n, true);
    await arbitratorMultisig.connect(investorA).resolveDispute(0n, true);

    expect(await stablecoin.balanceOf(investorA.address)).to.equal(investorBalanceBeforeDistribute + repaymentAmount);
    expect(await stablecoin.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await nft.getReputation(originator.address)).to.equal(51n);
  });

  it("reverts if funding is attempted before a risk oracle is configured", async () => {
    const [deployer, originator, investorA, investorB, investorC] = await ethers.getSigners();

    const MockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
    const stablecoin = await MockStablecoinFactory.deploy();

    const ArbitratorMultisigFactory = await ethers.getContractFactory("ArbitratorMultisig");
    const arbitratorMultisig = await ArbitratorMultisigFactory.deploy([
      investorA.address,
      investorB.address,
      investorC.address,
    ]);

    const VeriflowClaimVaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
    const vault = await VeriflowClaimVaultFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      investorC.address,
      1n,
    );

    const VeriflowClaimNFTFactory = await ethers.getContractFactory("VeriflowClaimNFT");
    const nft = await VeriflowClaimNFTFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      await vault.getAddress(),
    );

    await nft.connect(deployer).setAllowlisted(originator.address, true);
    await nft.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await nft.connect(deployer).setVault(await vault.getAddress());
    await vault.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await vault.connect(deployer).setVault(investorC.address);
    await vault.connect(deployer).setClaimNFT(await nft.getAddress());

    await stablecoin.mint(originator.address, ethers.parseUnits("500000", 18));
    await stablecoin.mint(investorA.address, ethers.parseUnits("500000", 18));
    await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(investorA).approve(await vault.getAddress(), ethers.MaxUint256);

    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    await nft.connect(originator).lockCollateral(0n, COLLATERAL);

    await expect(vault.connect(investorA).fundClaim(0n, CLAIM_AMOUNT)).to.be.revertedWithCustomError(
      vault,
      "RiskOracleNotSet",
    );
  });

  it("caps investor funding at claim amount minus required collateral when risk oracle is configured", async () => {
    const [deployer, originator, investorA, investorB, investorC] = await ethers.getSigners();

    const MockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
    const stablecoin = await MockStablecoinFactory.deploy();

    const RiskOracleFactory = await ethers.getContractFactory("RiskOracle");
    const riskOracle = await RiskOracleFactory.deploy();

    const ArbitratorMultisigFactory = await ethers.getContractFactory("ArbitratorMultisig");
    const arbitratorMultisig = await ArbitratorMultisigFactory.deploy([
      investorA.address,
      investorB.address,
      investorC.address,
    ]);

    const VeriflowClaimVaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
    const vault = await VeriflowClaimVaultFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      investorC.address,
      1n,
    );

    const VeriflowClaimNFTFactory = await ethers.getContractFactory("VeriflowClaimNFT");
    const nft = await VeriflowClaimNFTFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      await vault.getAddress(),
    );

    await nft.connect(deployer).setAllowlisted(originator.address, true);
    await nft.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await nft.connect(deployer).setVault(await vault.getAddress());
    await vault.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await vault.connect(deployer).setVault(investorC.address);
    await vault.connect(deployer).setClaimNFT(await nft.getAddress());
    await vault.connect(deployer).setRiskOracle(await riskOracle.getAddress());

    await stablecoin.mint(originator.address, ethers.parseUnits("500000", 18));
    await stablecoin.mint(investorA.address, ethers.parseUnits("500000", 18));
    await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(originator).approve(await vault.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(investorA).approve(await vault.getAddress(), ethers.MaxUint256);

    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    const requiredCollateral = await riskOracle.getRequiredCollateral(ClaimType.Invoice, CLAIM_AMOUNT);
    await nft.connect(originator).lockCollateral(0n, requiredCollateral);

    await expect(vault.connect(investorA).fundClaim(0n, CLAIM_AMOUNT)).to.be.revertedWithCustomError(
      vault,
      "FundingAboveCap",
    );

    const maxFunding = CLAIM_AMOUNT - requiredCollateral;
    await vault.connect(investorA).fundClaim(0n, maxFunding);
    expect(await stablecoin.balanceOf(originator.address)).to.equal(ethers.parseUnits("500000", 18) - requiredCollateral + maxFunding);
  });

  it("dispute path: vault handles dispute evidence and multisig slashes collateral", async () => {
    const [deployer, originator, investorA, investorB, investorC] = await ethers.getSigners();

    const MockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
    const stablecoin = await MockStablecoinFactory.deploy();

    const ArbitratorMultisigFactory = await ethers.getContractFactory("ArbitratorMultisig");
    const arbitratorMultisig = await ArbitratorMultisigFactory.deploy([
      investorA.address,
      investorB.address,
      investorC.address,
    ]);

    const VeriflowClaimVaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
    const vault = await VeriflowClaimVaultFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      investorC.address,
      1n,
    );

    const VeriflowClaimNFTFactory = await ethers.getContractFactory("VeriflowClaimNFT");
    const nft = await VeriflowClaimNFTFactory.deploy(
      await stablecoin.getAddress(),
      await arbitratorMultisig.getAddress(),
      await vault.getAddress(),
    );

    await nft.connect(deployer).setAllowlisted(originator.address, true);
    await nft.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await nft.connect(deployer).setVault(await vault.getAddress());
    await vault.connect(deployer).setArbitrator(await arbitratorMultisig.getAddress());
    await vault.connect(deployer).setVault(investorC.address);
    await vault.connect(deployer).setClaimNFT(await nft.getAddress());

    const RiskOracleFactory2 = await ethers.getContractFactory("RiskOracle");
    const riskOracle2 = await RiskOracleFactory2.deploy();
    await vault.connect(deployer).setRiskOracle(await riskOracle2.getAddress());

    await stablecoin.mint(originator.address, ethers.parseUnits("500000", 18));
    await stablecoin.mint(investorA.address, ethers.parseUnits("500000", 18));
    await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(originator).approve(await vault.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(investorA).approve(await vault.getAddress(), ethers.MaxUint256);

    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    await nft.connect(originator).lockCollateral(0n, COLLATERAL);
    const requiredCollateral2 = await riskOracle2.getRequiredCollateral(ClaimType.Invoice, CLAIM_AMOUNT);
    const maxFunding2 = CLAIM_AMOUNT - requiredCollateral2;
    await vault.connect(investorA).fundClaim(0n, maxFunding2);

    const disputeHash = ethers.keccak256(ethers.toUtf8Bytes("dispute-rejected-001"));
    await vault.connect(investorA).raiseDispute(0n, disputeHash);

    await arbitratorMultisig.connect(investorA).setClaimNFT(await nft.getAddress());
    await arbitratorMultisig.connect(investorA).setClaimVault(await vault.getAddress());

    const investorBalanceBefore = await stablecoin.balanceOf(investorA.address);

    await arbitratorMultisig.connect(investorA).voteDispute(0n, false);
    await arbitratorMultisig.connect(investorB).voteDispute(0n, false);
    await arbitratorMultisig.connect(investorA).resolveDispute(0n, false);

    expect(await nft.getReputation(originator.address)).to.equal(49n);
    expect(await stablecoin.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await stablecoin.balanceOf(investorA.address)).to.equal(investorBalanceBefore + COLLATERAL);
  });
});
