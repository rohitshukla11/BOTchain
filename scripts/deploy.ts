import hre from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";

const { ethers } = await hre.network.create();

/** Every state-changing tx is funnelled through here so hashes are recorded and mined. */
const txLog: { step: string; hash: string; block: number }[] = [];

async function send(step: string, promise: Promise<any>) {
  const tx = await promise;
  const receipt = await tx.wait();
  txLog.push({ step, hash: tx.hash, block: receipt.blockNumber });
  console.log(`  ${step.padEnd(34)} ${tx.hash}  (block ${receipt.blockNumber})`);
  return receipt;
}

async function deployed(step: string, contract: any) {
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  const receipt = tx ? await tx.wait() : null;
  txLog.push({ step, hash: tx?.hash ?? "unknown", block: receipt?.blockNumber ?? 0 });
  console.log(`  ${step.padEnd(34)} ${address}`);
  console.log(`  ${"↳ txHash".padEnd(34)} ${tx?.hash ?? "unknown"}  (block ${receipt?.blockNumber ?? "?"})`);
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  // ── Pre-flight ────────────────────────────────────────────────────────────
  // Deploying to the wrong chain is unrecoverable, so refuse to guess. Set
  // EXPECTED_CHAIN_ID=677 for BOT Chain Mainnet, 968 for Testnet.
  const expected = process.env.EXPECTED_CHAIN_ID;
  if (!expected) {
    throw new Error("EXPECTED_CHAIN_ID is not set. Refusing to deploy without an explicit target chain.");
  }
  if (chainId !== Number(expected)) {
    throw new Error(`Chain mismatch: connected to ${chainId}, expected ${expected}. Aborting.`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has zero balance on chain ${chainId}. Fund it before deploying.`);
  }

  console.log(`Network   : chainId ${chainId}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Balance   : ${ethers.formatEther(balance)} BOT\n`);

  const arbitratorOwners = [
    process.env.ARBITRATOR_1,
    process.env.ARBITRATOR_2,
    process.env.ARBITRATOR_3,
  ];
  if (arbitratorOwners.some((a) => !a)) {
    throw new Error("ARBITRATOR_1/2/3 must all be set — placeholder owners would make the multisig unusable.");
  }

  // ArbitratorMultisig.onlyOwner gates on isOwner[msg.sender], not Ownable, so
  // setClaimNFT/setClaimVault can only be called by one of the three arbitrators.
  // Check it here rather than discovering it after five contracts are already paid for.
  const owners = arbitratorOwners.map((a) => ethers.getAddress(a!));
  if (!owners.includes(ethers.getAddress(deployer.address))) {
    throw new Error(
      `Deployer ${deployer.address} is not one of ARBITRATOR_1/2/3 (${owners.join(", ")}). ` +
        `The multisig wiring calls would revert with NotOwner(). Set one arbitrator to the deployer.`,
    );
  }

  // ── Deploy (dependency order) ─────────────────────────────────────────────
  // ArbitratorMultisig must precede the Vault: the Vault constructor takes a
  // non-zero arbitrator address. NFT is last — it takes the Vault address.
  console.log("Deploying:");

  const stablecoin = await (await ethers.getContractFactory("MockStablecoin")).deploy();
  const stablecoinAddr = await deployed("MockStablecoin", stablecoin);

  const riskOracle = await (await ethers.getContractFactory("RiskOracle")).deploy();
  const riskOracleAddr = await deployed("RiskOracle", riskOracle);

  const multisig = await (await ethers.getContractFactory("ArbitratorMultisig")).deploy(arbitratorOwners);
  const multisigAddr = await deployed("ArbitratorMultisig", multisig);

  const vault = await (await ethers.getContractFactory("VeriflowClaimVault")).deploy(
    stablecoinAddr,
    multisigAddr,
    "0x000000000000000000000000000000000000dEaD",
    BigInt(process.env.CHALLENGE_WINDOW_SECONDS ?? "300"),
  );
  const vaultAddr = await deployed("VeriflowClaimVault", vault);

  const nft = await (await ethers.getContractFactory("VeriflowClaimNFT")).deploy(
    stablecoinAddr,
    multisigAddr,
    vaultAddr,
  );
  const nftAddr = await deployed("VeriflowClaimNFT", nft);

  // ── Wiring ────────────────────────────────────────────────────────────────
  console.log("\nWiring:");
  await send("nft.setArbitrator", nft.setArbitrator(multisigAddr));
  await send("nft.setVault", nft.setVault(vaultAddr));

  await send("vault.setArbitrator", vault.setArbitrator(multisigAddr));
  await send("vault.setClaimNFT", vault.setClaimNFT(nftAddr));
  await send("vault.setRiskOracle", vault.setRiskOracle(riskOracleAddr));

  // Without these the multisig holds address(0) for both targets and every
  // resolveDispute call reverts — dispute resolution would be dead on arrival.
  await send("multisig.setClaimNFT", multisig.setClaimNFT(nftAddr));
  await send("multisig.setClaimVault", multisig.setClaimVault(vaultAddr));

  // ── Test fixtures ─────────────────────────────────────────────────────────
  console.log("\nTest fixtures:");
  const originators = [
    deployer.address,
    ...(process.env.TEST_ORIGINATORS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ];
  const uniqueOriginators = [...new Set(originators.map((a) => ethers.getAddress(a)))];
  for (const originator of uniqueOriginators) {
    await send(`allowlist ${originator.slice(0, 10)}…`, nft.setAllowlisted(originator, true));
  }

  const mintAmount = ethers.parseUnits(process.env.TEST_MINT_AMOUNT ?? "1000000", 18);
  const mintTargets = [
    ...uniqueOriginators,
    ...(process.env.TEST_INVESTORS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => ethers.getAddress(a)),
  ];
  for (const target of [...new Set(mintTargets)]) {
    await send(`mint mUSD ${target.slice(0, 10)}…`, stablecoin.mint(target, mintAmount));
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const addresses = {
    MockStablecoin: stablecoinAddr,
    RiskOracle: riskOracleAddr,
    ArbitratorMultisig: multisigAddr,
    VeriflowClaimVault: vaultAddr,
    VeriflowClaimNFT: nftAddr,
  };

  mkdirSync("deployments", { recursive: true });
  const outPath = `deployments/${chainId}.json`;
  writeFileSync(outPath, JSON.stringify({ chainId, deployer: deployer.address, addresses, transactions: txLog }, null, 2));

  console.log("\n── Addresses ──");
  for (const [name, addr] of Object.entries(addresses)) console.log(`  ${name.padEnd(20)} ${addr}`);
  console.log(`\n── ${txLog.length} transactions written to ${outPath} ──`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
