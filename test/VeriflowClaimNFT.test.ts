import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const enum ClaimType {
  Invoice = 0,
  Royalty = 1,
  Rental = 2,
}

const ONE_DAY = 86_400n;
const COLLATERAL_AMOUNT = ethers.parseUnits("500", 18);
const CLAIM_AMOUNT = ethers.parseUnits("10000", 18);

async function futureDueDate(): Promise<bigint> {
  const latest = await ethers.provider.getBlock("latest");
  return BigInt(latest!.timestamp) + ONE_DAY * 30n;
}

async function deployFixture() {
  const [owner, originator, otherOriginator, arbitrator, vault, stranger] = await ethers.getSigners();

  const MockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
  const stablecoin = await MockStablecoinFactory.deploy();

  const VeriflowClaimNFTFactory = await ethers.getContractFactory("VeriflowClaimNFT");
  const nft = await VeriflowClaimNFTFactory.deploy(
    await stablecoin.getAddress(),
    arbitrator.address,
    vault.address,
  );

  await stablecoin.mint(originator.address, ethers.parseUnits("1000000", 18));
  await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256);

  return { nft, stablecoin, owner, originator, otherOriginator, arbitrator, vault, stranger };
}

describe("VeriflowClaimNFT", () => {
  it("owner can allowlist an originator", async () => {
    const { nft, originator, owner } = await deployFixture();
    await expect(nft.connect(owner).setAllowlisted(originator.address, true))
      .to.emit(nft, "OriginatorAllowlisted")
      .withArgs(originator.address, true);
    expect(await nft.allowlistedOriginators(originator.address)).to.equal(true);
  });

  it("non-allowlisted address cannot mint", async () => {
    const { nft, stranger } = await deployFixture();
    await expect(
      nft.connect(stranger).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash),
    ).to.be.revertedWith("VeriflowClaimNFT: not allowlisted");
  });

  it("allowlisted originator can mint a claim", async () => {
    const { nft, originator, owner } = await deployFixture();
    await nft.connect(owner).setAllowlisted(originator.address, true);

    const dueDate = await futureDueDate();
    const debtRef = ethers.keccak256(ethers.toUtf8Bytes("debtor-001"));

    await expect(
      nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, dueDate, debtRef),
    )
      .to.emit(nft, "ClaimMinted")
      .withArgs(0n, originator.address, ClaimType.Invoice, CLAIM_AMOUNT, dueDate);

    expect(await nft.ownerOf(0n)).to.equal(originator.address);
  });

  it("locks collateral and transfers stablecoin to the contract", async () => {
    const { nft, originator, owner, stablecoin } = await deployFixture();
    await nft.connect(owner).setAllowlisted(originator.address, true);
    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);

    const before = await stablecoin.balanceOf(await nft.getAddress());
    await expect(nft.connect(originator).lockCollateral(0n, COLLATERAL_AMOUNT))
      .to.emit(nft, "CollateralLocked")
      .withArgs(0n, originator.address, COLLATERAL_AMOUNT);

    expect(await stablecoin.balanceOf(await nft.getAddress())).to.equal(before + COLLATERAL_AMOUNT);
    const collateral = await nft.collateral(0n);
    expect(collateral.locked).to.equal(true);
    expect(collateral.amount).to.equal(COLLATERAL_AMOUNT);
  });

  it("releases collateral and increments reputation", async () => {
    const { nft, originator, owner, stablecoin } = await deployFixture();
    await nft.connect(owner).setAllowlisted(originator.address, true);
    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    await nft.connect(originator).lockCollateral(0n, COLLATERAL_AMOUNT);

    const before = await stablecoin.balanceOf(originator.address);
    await expect(nft.connect(originator).releaseCollateral(0n))
      .to.emit(nft, "CollateralReleased")
      .withArgs(0n, originator.address, COLLATERAL_AMOUNT);

    expect(await stablecoin.balanceOf(originator.address)).to.equal(before + COLLATERAL_AMOUNT);
    expect(await nft.getReputation(originator.address)).to.equal(51n);
  });

  it("slashes collateral and decrements reputation", async () => {
    const { nft, originator, owner, arbitrator, vault, stablecoin } = await deployFixture();
    await nft.connect(owner).setAllowlisted(originator.address, true);
    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    await nft.connect(originator).lockCollateral(0n, COLLATERAL_AMOUNT);

    const beforeVault = await stablecoin.balanceOf(vault.address);
    await expect(nft.connect(arbitrator).slashCollateral(0n))
      .to.emit(nft, "CollateralSlashed")
      .withArgs(0n, originator.address, COLLATERAL_AMOUNT, vault.address);

    expect(await stablecoin.balanceOf(vault.address)).to.equal(beforeVault + COLLATERAL_AMOUNT);
    expect(await nft.getReputation(originator.address)).to.equal(49n);
  });

  it("non-owner cannot update allowlist", async () => {
    const { nft, originator, stranger } = await deployFixture();
    await expect(
      nft.connect(stranger).setAllowlisted(originator.address, true),
    ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
  });

  it("non-arbitrator cannot slash", async () => {
    const { nft, originator, owner, stranger } = await deployFixture();
    await nft.connect(owner).setAllowlisted(originator.address, true);
    await nft.connect(originator).mintClaim(ClaimType.Invoice, CLAIM_AMOUNT, await futureDueDate(), ethers.ZeroHash);
    await nft.connect(originator).lockCollateral(0n, COLLATERAL_AMOUNT);

    await expect(
      nft.connect(stranger).slashCollateral(0n),
    ).to.be.revertedWith("VeriflowClaimNFT: not arbitrator");
  });
});
