import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

describe("ArbitratorMultisig", () => {
  async function deployFixture() {
    const [owner1, owner2, owner3, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ArbitratorMultisig");
    const multisig = await factory.deploy([owner1.address, owner2.address, owner3.address]);
    return { multisig, owner1, owner2, owner3, stranger };
  }

  it("sets three owners and exposes them", async () => {
    const { multisig, owner1, owner2, owner3 } = await deployFixture();
    const owners = await multisig.ownersList();
    expect(owners).to.have.members([owner1.address, owner2.address, owner3.address]);
  });

  it("votes on a claim only from an owner", async () => {
    const { multisig, stranger } = await deployFixture();
    await expect(multisig.connect(stranger).voteDispute(0n, true)).to.be.revertedWithCustomError(
      multisig,
      "NotOwner",
    );
  });

  it("requires 2-of-3 votes before claim resolution", async () => {
    const { multisig, owner1, owner2 } = await deployFixture();
    await multisig.connect(owner1).voteDispute(0n, true);

    await expect(multisig.connect(owner2).resolveDispute(0n, true)).to.be.revertedWithCustomError(
      multisig,
      "QuorumNotReached",
    );
  });

  it("prevents duplicate votes from the same owner on the same claim", async () => {
    const { multisig, owner1 } = await deployFixture();
    await multisig.connect(owner1).voteDispute(0n, true);

    await expect(multisig.connect(owner1).voteDispute(0n, true)).to.be.revertedWithCustomError(
      multisig,
      "AlreadyVoted",
    );
  });

  it("cannot resolve an already resolved claim", async () => {
    const [owner1, owner2, owner3] = await ethers.getSigners();
    const stablecoinFactory = await ethers.getContractFactory("MockStablecoin");
    const stablecoin = await stablecoinFactory.deploy();

    const nftFactory = await ethers.getContractFactory("VeriflowClaimNFT");
    const nft = await nftFactory.deploy(await stablecoin.getAddress(), owner3.address, owner3.address);

    const riskOracleFactory = await ethers.getContractFactory("RiskOracle");
    const riskOracle = await riskOracleFactory.deploy();

    const vaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
    const vault = await vaultFactory.deploy(
      await stablecoin.getAddress(),
      owner3.address,
      owner3.address,
      1n,
    );

    const factory = await ethers.getContractFactory("ArbitratorMultisig");
    const multisig = await factory.deploy([owner1.address, owner2.address, owner3.address]);

    await multisig.connect(owner1).setClaimNFT(await nft.getAddress());
    await multisig.connect(owner1).setClaimVault(await vault.getAddress());

    await stablecoin.mint(owner1.address, ethers.parseUnits("1000000", 18));
    await stablecoin.mint(owner2.address, ethers.parseUnits("1000000", 18));
    await stablecoin.connect(owner1).approve(await nft.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(owner2).approve(await vault.getAddress(), ethers.MaxUint256);
    await nft.connect(owner1).setAllowlisted(owner1.address, true);
    await nft.connect(owner1).setArbitrator(await multisig.getAddress());
    await nft.connect(owner1).setVault(await vault.getAddress());
    await vault.connect(owner1).setArbitrator(await multisig.getAddress());
    await vault.connect(owner1).setVault(owner3.address);
    await vault.connect(owner1).setClaimNFT(await nft.getAddress());
    await vault.connect(owner1).setRiskOracle(await riskOracle.getAddress());
    await nft.connect(owner1).mintClaim(0, ethers.parseUnits("1000", 18), 2000000000n, ethers.ZeroHash);
    await nft.connect(owner1).lockCollateral(0n, ethers.parseUnits("100", 18));
    // cap = 1000 - 100 (oracle required for 10% Invoice) = 900 mUSD
    await vault.connect(owner2).fundClaim(0n, ethers.parseUnits("900", 18));
    await stablecoin.connect(owner1).approve(await vault.getAddress(), ethers.parseUnits("1100", 18));
    await vault.connect(owner1).submitRepaymentEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("repayment-proof-001")));
    // repayment = 900 * 1.1 = 990
    await vault.connect(owner1).depositRepayment(0n, ethers.parseUnits("990", 18));

    await multisig.connect(owner1).voteDispute(0n, true);
    await multisig.connect(owner2).voteDispute(0n, true);
    await multisig.connect(owner1).resolveDispute(0n, true);

    await expect(multisig.connect(owner1).resolveDispute(0n, true)).to.be.revertedWithCustomError(
      multisig,
      "DisputeAlreadyResolved",
    );
  });
});
