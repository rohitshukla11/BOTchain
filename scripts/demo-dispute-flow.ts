import hre from "hardhat";

const { ethers } = await hre.network.create();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL ?? "https://rpc.bohr.life");
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const originatorKey = process.env.ORIGINATOR_PRIVATE_KEY;
  const investorKey = process.env.INVESTOR_PRIVATE_KEY;

  if (!deployerKey || !originatorKey || !investorKey) {
    throw new Error(
      "Missing wallet keys. Set DEPLOYER_PRIVATE_KEY, ORIGINATOR_PRIVATE_KEY, and INVESTOR_PRIVATE_KEY in .env before running the live dispute demo.",
    );
  }

  const deployer = new ethers.Wallet(deployerKey, provider);
  const originator = new ethers.Wallet(originatorKey, provider);
  const investor = new ethers.Wallet(investorKey, provider);

  const stablecoinFactory = await ethers.getContractFactory("MockStablecoin", deployer);
  const stablecoin = await stablecoinFactory.deploy();
  await stablecoin.waitForDeployment();
  console.log("\n[1] Deployed MockStablecoin:", await stablecoin.getAddress());

  const riskOracleFactory = await ethers.getContractFactory("RiskOracle", deployer);
  const riskOracle = await riskOracleFactory.deploy();
  await riskOracle.waitForDeployment();
  console.log("[2] Deployed RiskOracle:", await riskOracle.getAddress());
  console.log("  txHash =", riskOracle.deploymentTransaction()?.hash ?? "pending");

  const multisigFactory = await ethers.getContractFactory("ArbitratorMultisig", deployer);
  const multisig = await multisigFactory.deploy([deployer.address, originator.address, investor.address]);
  await multisig.waitForDeployment();
  console.log("[3] Deployed ArbitratorMultisig:", await multisig.getAddress());
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
  console.log("[4] Deployed VeriflowClaimVault:", await vault.getAddress());
  console.log("  txHash =", vault.deploymentTransaction()?.hash ?? "pending");

  const nftFactory = await ethers.getContractFactory("VeriflowClaimNFT", deployer);
  const nft = await nftFactory.deploy(
    await stablecoin.getAddress(),
    await multisig.getAddress(),
    await vault.getAddress(),
  );
  await nft.waitForDeployment();
  console.log("[5] Deployed VeriflowClaimNFT:", await nft.getAddress());
  console.log("  txHash =", nft.deploymentTransaction()?.hash ?? "pending");

  await (await nft.setAllowlisted(originator.address, true)).wait();
  await (await nft.setArbitrator(await multisig.getAddress())).wait();
  await (await nft.setVault(await vault.getAddress())).wait();
  await (await vault.setArbitrator(await multisig.getAddress())).wait();
  await (await vault.setVault(investor.address)).wait();
  await (await vault.setClaimNFT(await nft.getAddress())).wait();
  await (await vault.setRiskOracle(await riskOracle.getAddress())).wait();
  await (await multisig.setClaimNFT(await nft.getAddress())).wait();
  await (await multisig.setClaimVault(await vault.getAddress())).wait();
  console.log("[6] Wired contracts (incl. RiskOracle)");

  const claimAmount = ethers.parseUnits("10000", 18);
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
  const collateralRequired = await riskOracle.getRequiredCollateral(0, claimAmount);
  const maxFundingAmount = claimAmount - collateralRequired;

  await (await stablecoin.mint(originator.address, ethers.parseUnits("2000000", 18))).wait();
  await (await stablecoin.mint(investor.address, ethers.parseUnits("2000000", 18))).wait();
  await (await stablecoin.connect(originator).approve(await nft.getAddress(), ethers.MaxUint256)).wait();
  await (await stablecoin.connect(investor).approve(await vault.getAddress(), ethers.MaxUint256)).wait();

  const vaultAddr = await vault.getAddress();

  const logBalances = async (tag: string) => {
    const v = await stablecoin.balanceOf(vaultAddr);
    const o = await stablecoin.balanceOf(originator.address);
    const i = await stablecoin.balanceOf(investor.address);
    console.log(`\n  ${tag}`);
    console.log(`    vault      = ${ethers.formatUnits(v, 18)}`);
    console.log(`    originator = ${ethers.formatUnits(o, 18)}`);
    console.log(`    investor   = ${ethers.formatUnits(i, 18)}`);
  };

  console.log("\n[7] Risk query");
  console.log("  claimAmount        =", ethers.formatUnits(claimAmount, 18));
  console.log("  collateralRequired =", ethers.formatUnits(collateralRequired, 18));
  console.log("  maxFundingAmount   =", ethers.formatUnits(maxFundingAmount, 18));

  const tokenId = 0n;

  await logBalances("Before mintClaim");
  const mintTx = await nft.connect(originator).mintClaim(0, claimAmount, dueDate, ethers.keccak256(ethers.toUtf8Bytes("invoice-dispute-001")));
  await mintTx.wait();
  await logBalances("After  mintClaim");
  console.log("\n[8] Minted claim NFT tokenId=", tokenId.toString(), "tx=", mintTx.hash);

  await logBalances("Before lockCollateral");
  const lockTx = await nft.connect(originator).lockCollateral(tokenId, collateralRequired);
  await lockTx.wait();
  await logBalances("After  lockCollateral");
  console.log("[9] Locked collateral tx=", lockTx.hash);

  await logBalances("Before fundClaim");
  const fundTx = await vault.connect(investor).fundClaim(tokenId, maxFundingAmount);
  await fundTx.wait();
  await logBalances("After  fundClaim");
  console.log("[10] Investor funded claim (capped) tx=", fundTx.hash);

  await logBalances("Before submitRepaymentEvidence");
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-evidence-001"));
  const evidenceTx = await vault.connect(originator).submitRepaymentEvidence(tokenId, evidenceHash);
  await evidenceTx.wait();
  await logBalances("After  submitRepaymentEvidence");
  console.log("[11] Originator submitted evidence tx=", evidenceTx.hash);

  await logBalances("Before raiseDispute");
  const disputeHash = ethers.keccak256(ethers.toUtf8Bytes("dispute-rejected-001"));
  const disputeTx = await vault.connect(investor).raiseDispute(tokenId, disputeHash);
  await disputeTx.wait();
  await logBalances("After  raiseDispute");
  console.log("[12] Investor raised dispute tx=", disputeTx.hash);

  await (await multisig.connect(deployer).voteDispute(tokenId, false)).wait();
  await (await multisig.connect(originator).voteDispute(tokenId, false)).wait();
  console.log("[13] 2-of-3 arbitrators voted to reject dispute");

  await logBalances("Before resolveDispute (slash)");
  const executeSlashTx = await multisig.connect(deployer).resolveDispute(tokenId, false);
  await executeSlashTx.wait();
  await logBalances("After  resolveDispute (slash)");
  console.log("[14] Multisig resolved rejection tx=", executeSlashTx.hash);

  const collateralAfterSlash = await nft.collateral(tokenId);
  const reputationAfterSlash = await nft.getReputation(originator.address);
  console.log("\n[15] Slash result");
  console.log("  collateralLocked =", collateralAfterSlash.locked);
  console.log("  collateralAmount =", ethers.formatUnits(collateralAfterSlash.amount, 18));
  console.log("  reputation       =", reputationAfterSlash.toString());

  const investorFinalBalance = await stablecoin.balanceOf(investor.address);
  const vaultFinalBalance = await stablecoin.balanceOf(vaultAddr);
  console.log("\nFinal on-chain state:");
  console.log("  vaultBalance       =", ethers.formatUnits(vaultFinalBalance, 18));
  console.log("  investorBalance    =", ethers.formatUnits(investorFinalBalance, 18));
  console.log("  originatorReputation =", reputationAfterSlash.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
