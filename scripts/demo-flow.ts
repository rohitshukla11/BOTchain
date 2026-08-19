import hre from "hardhat";

const { ethers } = await hre.network.create();

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function logBalances(tag: string, stablecoin: any, vaultAddress: string, originator: ethers.Wallet, investor: ethers.Wallet) {
  const vaultBalance = await stablecoin.balanceOf(vaultAddress);
  const originatorBalance = await stablecoin.balanceOf(originator.address);
  const investorBalance = await stablecoin.balanceOf(investor.address);

  console.log(`\n${tag}`);
  console.log(`  vault = ${ethers.formatUnits(vaultBalance, 18)}`);
  console.log(`  originator = ${ethers.formatUnits(originatorBalance, 18)}`);
  console.log(`  investor = ${ethers.formatUnits(investorBalance, 18)}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL ?? "https://rpc.bohr.life");
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const originatorKey = process.env.ORIGINATOR_PRIVATE_KEY;
  const investorKey = process.env.INVESTOR_PRIVATE_KEY;

  if (!deployerKey || !originatorKey || !investorKey) {
    throw new Error(
      "Missing wallet keys. Set DEPLOYER_PRIVATE_KEY, ORIGINATOR_PRIVATE_KEY, and INVESTOR_PRIVATE_KEY in .env before running the live demo.",
    );
  }

  const deployer = new ethers.Wallet(deployerKey, provider);
  const originator = new ethers.Wallet(originatorKey, provider);
  const investor = new ethers.Wallet(investorKey, provider);

  console.log("Wallets:");
  console.log("  deployer =", deployer.address);
  console.log("  originator =", originator.address);
  console.log("  investor =", investor.address);

  const stablecoinFactory = await ethers.getContractFactory("MockStablecoin", deployer);
  const stablecoin = await stablecoinFactory.deploy();
  await stablecoin.waitForDeployment();
  console.log("\n[1] Deploy MockStablecoin");
  console.log("  address =", await stablecoin.getAddress());
  console.log("  txHash =", stablecoin.deploymentTransaction()?.hash ?? "pending");

  const riskOracleFactory = await ethers.getContractFactory("RiskOracle", deployer);
  const riskOracle = await riskOracleFactory.deploy();
  await riskOracle.waitForDeployment();
  console.log("\n[2] Deploy RiskOracle");
  console.log("  address =", await riskOracle.getAddress());
  console.log("  txHash =", riskOracle.deploymentTransaction()?.hash ?? "pending");

  const multisigFactory = await ethers.getContractFactory("ArbitratorMultisig", deployer);
  const arbitratorOwners = [deployer.address, originator.address, investor.address];
  const multisig = await multisigFactory.deploy(arbitratorOwners);
  await multisig.waitForDeployment();
  console.log("\n[3] Deploy ArbitratorMultisig");
  console.log("  address =", await multisig.getAddress());
  console.log("  txHash =", multisig.deploymentTransaction()?.hash ?? "pending");

  const vaultFactory = await ethers.getContractFactory("VeriflowClaimVault", deployer);
  const challengeWindowSeconds = BigInt(process.env.CHALLENGE_WINDOW_SECONDS ?? "90");
  const vault = await vaultFactory.deploy(
    await stablecoin.getAddress(),
    await multisig.getAddress(),
    investor.address,
    challengeWindowSeconds,
  );
  await vault.waitForDeployment();
  console.log("\n[4] Deploy VeriflowClaimVault");
  console.log("  address =", await vault.getAddress());
  console.log("  txHash =", vault.deploymentTransaction()?.hash ?? "pending");

  const nftFactory = await ethers.getContractFactory("VeriflowClaimNFT", deployer);
  const nft = await nftFactory.deploy(
    await stablecoin.getAddress(),
    await multisig.getAddress(),
    await vault.getAddress(),
  );
  await nft.waitForDeployment();
  console.log("\n[5] Deploy VeriflowClaimNFT");
  console.log("  address =", await nft.getAddress());
  console.log("  txHash =", nft.deploymentTransaction()?.hash ?? "pending");
  console.log("  challengeWindow =", await vault.challengeWindow(), "seconds");

  await (await nft.setAllowlisted(originator.address, true)).wait();
  await (await nft.setArbitrator(await multisig.getAddress())).wait();
  await (await nft.setVault(await vault.getAddress())).wait();
  await (await vault.setArbitrator(await multisig.getAddress())).wait();
  await (await vault.setVault(investor.address)).wait();
  await (await vault.setClaimNFT(await nft.getAddress())).wait();
  await (await vault.setRiskOracle(await riskOracle.getAddress())).wait();
  await (await multisig.setClaimNFT(await nft.getAddress())).wait();
  await (await multisig.setClaimVault(await vault.getAddress())).wait();
  console.log("\n[6] Wire NFT <-> Vault <-> Multisig");

  const claimAmount = ethers.parseUnits("10000", 18);
  const collateralRequired = await riskOracle.getRequiredCollateral(0, claimAmount);
  console.log("\n[7] Query risk oracle");
  console.log("  claimType = Invoice");
  console.log("  claimAmount =", ethers.formatUnits(claimAmount, 18), "USD");
  console.log("  collateralRequired =", ethers.formatUnits(collateralRequired, 18), "USD");

  await (await stablecoin.mint(originator.address, ethers.parseUnits("1000000", 18))).wait();
  await (await stablecoin.mint(investor.address, ethers.parseUnits("1000000", 18))).wait();
  await (await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256)).wait();
  await (await stablecoin.connect(investor).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
  console.log("\n[8] Fund demo accounts");
  console.log("  originator stablecoin =", ethers.formatUnits(await stablecoin.balanceOf(originator.address), 18));
  console.log("  investor stablecoin =", ethers.formatUnits(await stablecoin.balanceOf(investor.address), 18));

  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
  const tokenId = 0n;

  await logBalances("[9] Before mintClaim", stablecoin, await vault.getAddress(), originator, investor);
  const mintTx = await nft.connect(originator).mintClaim(0, claimAmount, dueDate, ethers.keccak256(ethers.toUtf8Bytes("invoice-001")));
  await mintTx.wait();
  await logBalances("[9] After mintClaim", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[9] Mint claim NFT");
  console.log("  tokenId =", tokenId.toString());
  console.log("  txHash =", mintTx.hash);

  await logBalances("[10] Before lockCollateral", stablecoin, await vault.getAddress(), originator, investor);
  const lockTx = await nft.connect(originator).lockCollateral(tokenId, collateralRequired);
  await lockTx.wait();
  await logBalances("[10] After lockCollateral", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[10] Lock collateral");
  console.log("  txHash =", lockTx.hash);
  const collateralAfterLock = await nft.collateral(tokenId);
  console.log("  collateralLocked =", collateralAfterLock.locked, "amount =", ethers.formatUnits(collateralAfterLock.amount, 18));

  await logBalances("[11] Before fundClaim", stablecoin, await vault.getAddress(), originator, investor);
  const maxFundingAmount = claimAmount - collateralRequired;
  const fundClaimTx = await vault.connect(investor).fundClaim(tokenId, maxFundingAmount);
  await fundClaimTx.wait();
  await logBalances("[11] After fundClaim", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[11] Fund the claim from investor");
  console.log("  txHash =", fundClaimTx.hash);

  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("repayment-proof-001"));
  await logBalances("[12] Before submitRepaymentEvidence", stablecoin, await vault.getAddress(), originator, investor);
  const evidenceTx = await vault.connect(originator).submitRepaymentEvidence(tokenId, evidenceHash);
  await evidenceTx.wait();
  await logBalances("[12] After submitRepaymentEvidence", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[12] Submit repayment evidence");
  console.log("  txHash =", evidenceTx.hash);

  const repaymentAmount = claimAmount + (claimAmount * 10n / 100n);
  await (await stablecoin.connect(originator).approve(await vault.getAddress(), repaymentAmount)).wait();
  await logBalances("[13] Before depositRepayment", stablecoin, await vault.getAddress(), originator, investor);
  const repaymentTx = await vault.connect(originator).depositRepayment(tokenId, repaymentAmount);
  await repaymentTx.wait();
  await logBalances("[13] After depositRepayment", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[13] Deposit repayment");
  console.log("  txHash =", repaymentTx.hash);
  console.log("  expected repayment =", ethers.formatUnits(repaymentAmount, 18));

  console.log("\n[14] Waiting for challengeWindow expiry...", Number(challengeWindowSeconds), "seconds");
  await sleep(Number(challengeWindowSeconds) + 2);

  await logBalances("[15] Before distributeToInvestors", stablecoin, await vault.getAddress(), originator, investor);
  const distributeTx = await vault.connect(investor).distributeToInvestors(tokenId);
  await distributeTx.wait();
  await logBalances("[15] After distributeToInvestors", stablecoin, await vault.getAddress(), originator, investor);
  const vaultBalanceAfterDistribution = await stablecoin.balanceOf(await vault.getAddress());
  console.log("\n[15] Distribute to investors");
  console.log("  txHash =", distributeTx.hash);
  console.log("  vault balance attributable to this claim =", ethers.formatUnits(vaultBalanceAfterDistribution, 18));
  if (vaultBalanceAfterDistribution !== 0n) {
    throw new Error(`Expected claim-specific vault balance to be zero after distributeToInvestors, got ${vaultBalanceAfterDistribution.toString()}`);
  }

  await logBalances("[16] Before releaseCollateral", stablecoin, await vault.getAddress(), originator, investor);
  const releaseTx = await nft.connect(originator).releaseCollateral(tokenId);
  await releaseTx.wait();
  await logBalances("[16] After releaseCollateral", stablecoin, await vault.getAddress(), originator, investor);
  console.log("\n[16] Release collateral back to originator");
  console.log("  txHash =", releaseTx.hash);

  const finalCollateral = await nft.collateral(tokenId);
  const finalReputation = await nft.getReputation(originator.address);
  const vaultBalance = await stablecoin.balanceOf(await vault.getAddress());
  const investorBalance = await stablecoin.balanceOf(investor.address);
  const originatorBalance = await stablecoin.balanceOf(originator.address);

  console.log("\nFinal on-chain state:");
  console.log("  vaultBalance =", ethers.formatUnits(vaultBalance, 18));
  console.log("  investorBalance =", ethers.formatUnits(investorBalance, 18));
  console.log("  originatorBalance =", ethers.formatUnits(originatorBalance, 18));
  console.log("  collateralLocked =", finalCollateral.locked);
  console.log("  collateralAmount =", ethers.formatUnits(finalCollateral.amount, 18));
  console.log("  reputation =", finalReputation.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
