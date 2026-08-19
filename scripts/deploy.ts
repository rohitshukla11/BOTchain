import hre from "hardhat";

const { ethers } = await hre.network.create();

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with:", deployer.address);

  const mockStablecoinFactory = await ethers.getContractFactory("MockStablecoin");
  const stablecoin = await mockStablecoinFactory.deploy();
  await stablecoin.waitForDeployment();
  console.log("MockStablecoin deployed to:", await stablecoin.getAddress());

  const arbitratorOwners = [
    process.env.ARBITRATOR_1 ?? "0x1111111111111111111111111111111111111111",
    process.env.ARBITRATOR_2 ?? "0x2222222222222222222222222222222222222222",
    process.env.ARBITRATOR_3 ?? "0x3333333333333333333333333333333333333333",
  ];

  const riskOracleFactory = await ethers.getContractFactory("RiskOracle");
  const riskOracle = await riskOracleFactory.deploy();
  await riskOracle.waitForDeployment();
  console.log("RiskOracle deployed to:", await riskOracle.getAddress());
  console.log("RiskOracle deployment txHash:", riskOracle.deploymentTransaction()?.hash ?? "pending");

  const arbitratorMultisigFactory = await ethers.getContractFactory("ArbitratorMultisig");
  const multisig = await arbitratorMultisigFactory.deploy(arbitratorOwners);
  await multisig.waitForDeployment();
  console.log("ArbitratorMultisig deployed to:", await multisig.getAddress());
  console.log("ArbitratorMultisig deployment txHash:", multisig.deploymentTransaction()?.hash ?? "pending");

  const vaultFactory = await ethers.getContractFactory("VeriflowClaimVault");
  const vault = await vaultFactory.deploy(
    await stablecoin.getAddress(),
    await multisig.getAddress(),
    "0x000000000000000000000000000000000000dEaD",
    BigInt(process.env.CHALLENGE_WINDOW_SECONDS ?? "300"),
  );
  await vault.waitForDeployment();
  console.log("VeriflowClaimVault deployed to:", await vault.getAddress());
  console.log("VeriflowClaimVault deployment txHash:", vault.deploymentTransaction()?.hash ?? "pending");

  const nftFactory = await ethers.getContractFactory("VeriflowClaimNFT");
  const nft = await nftFactory.deploy(
    await stablecoin.getAddress(),
    await multisig.getAddress(),
    await vault.getAddress(),
  );
  await nft.waitForDeployment();
  console.log("VeriflowClaimNFT deployed to:", await nft.getAddress());
  console.log("VeriflowClaimNFT deployment txHash:", nft.deploymentTransaction()?.hash ?? "pending");

  await nft.setArbitrator(await multisig.getAddress());
  await nft.setVault(await vault.getAddress());

  await vault.setArbitrator(await multisig.getAddress());
  await vault.setVault("0x000000000000000000000000000000000000dEaD");
  await vault.setClaimNFT(await nft.getAddress());
  await vault.setRiskOracle(await riskOracle.getAddress());

  // Auto-allowlist the deployer as an originator so the demo works out of the box.
  await nft.setAllowlisted(deployer.address, true);
  console.log("Allowlisted originator:", deployer.address);

  console.log("Contract wiring complete: NFT <-> Vault <-> Multisig.");

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
