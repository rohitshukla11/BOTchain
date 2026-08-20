/**
 * seed-active-positions.mjs
 *
 * Seeds two new claims for the INVESTOR_PRIVATE_KEY wallet so My Positions
 * renders two different active-card states:
 *
 *   Claim A  →  "Funded - Repayment Due"  (fund only, no evidence)
 *   Claim B  →  "Evidence Submitted - Challenge Window Open"  (fund + evidence)
 *
 * Usage:
 *   node scripts/seed-active-positions.mjs
 *
 * Reads DEPLOYER_PRIVATE_KEY, ORIGINATOR_PRIVATE_KEY, INVESTOR_PRIVATE_KEY
 * from the .env file at the project root.
 */

import fs from 'fs';
import { ethers } from 'ethers';

// ── Config ───────────────────────────────────────────────────────────────────

const ENV = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const RPC_URL        = ENV.RPC_URL || 'https://rpc.bohr.life';
const DEPLOYER_KEY   = ENV.DEPLOYER_PRIVATE_KEY || ENV.PRIVATE_KEY;
const ORIGINATOR_KEY = ENV.ORIGINATOR_PRIVATE_KEY;
const INVESTOR_KEY   = ENV.INVESTOR_PRIVATE_KEY;

if (!DEPLOYER_KEY || !ORIGINATOR_KEY || !INVESTOR_KEY) {
  console.error('Missing wallet keys in .env');
  process.exit(1);
}

const NFT_ADDR      = '0xc4e7dD84165a5247637E106f4Bbe9520876D05b3';
const VAULT_ADDR    = '0xAC0B43de7893Ec6CaBFd25940987779668F1204B';
const STABLE_ADDR   = '0x2DC17aD3AF5E195c96d53c916F9e3c95FEea4bA2';
const ORACLE_ADDR   = '0xA94B7Fd8ac55Fd481B559caC159309Bc779f34c0';

// ── ABIs (only what we need) ──────────────────────────────────────────────────

const NFT_ABI = [
  'function owner() view returns (address)',
  'function totalClaims() view returns (uint256)',
  'function allowlistedOriginators(address) view returns (bool)',
  'function setAllowlisted(address originator, bool status) external',
  'function mintClaim(uint8 claimType, uint256 amount, uint256 dueDate, bytes32 debtorRef) external returns (uint256)',
  'function lockCollateral(uint256 claimId, uint256 amount) external',
  'function collateral(uint256) view returns (uint256 amount, bool locked)',
  'function claims(uint256) view returns (uint8 claimType, uint256 amount, uint256 dueDate, bytes32 debtorRef, address originator)',
];

const VAULT_ABI = [
  'function challengeWindow() view returns (uint256)',
  'function riskOracle() view returns (address)',
  'function fundClaim(uint256 claimId, uint256 amount) external',
  'function submitRepaymentEvidence(uint256 claimId, bytes32 evidenceHash) external',
  'function funding(uint256) view returns (address investor, uint256 fundedAmount, bool funded, bool evidenced, bytes32 evidenceHash, uint256 repaymentAmount, bool repaymentDeposited, uint256 fundedAt, bool disputed, bytes32 disputeEvidenceHash)',
];

const STABLE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const ORACLE_ABI = [
  'function getRequiredCollateral(uint8 claimType, uint256 claimAmount) view returns (uint256)',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = v => ethers.formatUnits(v, 18);

async function ensureBalance(stable, deployer, who, label, need) {
  const bal = await stable.balanceOf(who);
  if (bal < need) {
    const topup = need - bal + ethers.parseUnits('50000', 18);
    process.stdout.write(`  minting ${fmt(topup)} mUSD for ${label}... `);
    const tx = await stable.connect(deployer).mint(who, topup);
    await tx.wait();
    console.log('done');
  }
}

async function ensureApproval(stable, signer, spender, label, need) {
  const allowed = await stable.allowance(signer.address, spender);
  if (allowed < need) {
    process.stdout.write(`  approving ${label} → ${spender.slice(0, 8)}... `);
    const tx = await stable.connect(signer).approve(spender, ethers.MaxUint256);
    await tx.wait();
    console.log('done');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const provider   = new ethers.JsonRpcProvider(RPC_URL);
const deployer   = new ethers.Wallet(DEPLOYER_KEY, provider);
const originator = new ethers.Wallet(ORIGINATOR_KEY, provider);
const investor   = new ethers.Wallet(INVESTOR_KEY, provider);

const nft    = new ethers.Contract(NFT_ADDR,    NFT_ABI,    provider);
const vault  = new ethers.Contract(VAULT_ADDR,  VAULT_ABI,  provider);
const stable = new ethers.Contract(STABLE_ADDR, STABLE_ABI, provider);
const oracle = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI, provider);

console.log('Wallets');
console.log('  deployer  =', deployer.address);
console.log('  originator=', originator.address);
console.log('  investor  =', investor.address);

// ─── Pre-flight ───────────────────────────────────────────────────────────────

const isAllowlisted = await nft.allowlistedOriginators(originator.address);
if (!isAllowlisted) {
  process.stdout.write('\n[pre] Allowlisting originator... ');
  const tx = await nft.connect(deployer).setAllowlisted(originator.address, true);
  await tx.wait();
  console.log('done');
} else {
  console.log('\n[pre] Originator already allowlisted');
}

const claimAmount      = ethers.parseUnits('5000', 18);
const collateralNeeded = await oracle.getRequiredCollateral(0, claimAmount);
const fundAmount       = claimAmount - collateralNeeded;

console.log('\nAmounts:');
console.log('  claimAmount     =', fmt(claimAmount), 'mUSD');
console.log('  collateralNeeded=', fmt(collateralNeeded), 'mUSD');
console.log('  fundAmount      =', fmt(fundAmount), 'mUSD');

await ensureBalance(stable, deployer, originator.address, 'originator', collateralNeeded * 4n);
await ensureBalance(stable, deployer, investor.address,   'investor',   fundAmount * 4n);
await ensureApproval(stable, originator, NFT_ADDR,   'originator→NFT',   collateralNeeded * 4n);
await ensureApproval(stable, investor,   VAULT_ADDR, 'investor→Vault',   fundAmount * 4n);

// ─── Claim A: Funded, awaiting repayment (no evidence) ───────────────────────

console.log('\n── Claim A: "Funded - Repayment Due" ──────────────────────────');

const dueDate = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60); // 90 days

process.stdout.write('[A.1] mintClaim... ');
const mintATx = await nft.connect(originator).mintClaim(
  0,                                                       // Invoice
  claimAmount,
  dueDate,
  ethers.keccak256(ethers.toUtf8Bytes('invoice-seed-A')),
);
const mintAReceipt = await mintATx.wait();
// totalClaims-1 gives us the new id because it's auto-incremented starting from 0
const newTotal = await nft.totalClaims();
const claimIdA = newTotal - 1n;
console.log(`done  tokenId=${claimIdA}  tx=${mintATx.hash}`);

process.stdout.write('[A.2] lockCollateral... ');
const lockATx = await nft.connect(originator).lockCollateral(claimIdA, collateralNeeded);
await lockATx.wait();
console.log(`done  tx=${lockATx.hash}`);

process.stdout.write('[A.3] fundClaim (investor)... ');
const fundATx = await vault.connect(investor).fundClaim(claimIdA, fundAmount);
await fundATx.wait();
console.log(`done  tx=${fundATx.hash}`);

const fA = await vault.funding(claimIdA);
console.log(`[A] state: funded=${fA.funded} evidenced=${fA.evidenced} disputed=${fA.disputed}`);

// ─── Claim B: Evidence submitted, challenge window open ──────────────────────

console.log('\n── Claim B: "Evidence Submitted - Challenge Window Open" ──────');

process.stdout.write('[B.1] mintClaim... ');
const mintBTx = await nft.connect(originator).mintClaim(
  0,
  claimAmount,
  dueDate,
  ethers.keccak256(ethers.toUtf8Bytes('invoice-seed-B')),
);
await mintBTx.wait();
const newTotalB = await nft.totalClaims();
const claimIdB = newTotalB - 1n;
console.log(`done  tokenId=${claimIdB}  tx=${mintBTx.hash}`);

process.stdout.write('[B.2] lockCollateral... ');
const lockBTx = await nft.connect(originator).lockCollateral(claimIdB, collateralNeeded);
await lockBTx.wait();
console.log(`done  tx=${lockBTx.hash}`);

process.stdout.write('[B.3] fundClaim (investor)... ');
const fundBTx = await vault.connect(investor).fundClaim(claimIdB, fundAmount);
await fundBTx.wait();
console.log(`done  tx=${fundBTx.hash}`);

process.stdout.write('[B.4] submitRepaymentEvidence (originator)... ');
const evidenceTx = await vault.connect(originator).submitRepaymentEvidence(
  claimIdB,
  ethers.keccak256(ethers.toUtf8Bytes('repayment-proof-B')),
);
await evidenceTx.wait();
console.log(`done  tx=${evidenceTx.hash}`);

const fB = await vault.funding(claimIdB);
console.log(`[B] state: funded=${fB.funded} evidenced=${fB.evidenced} disputed=${fB.disputed}`);

// ─── Summary ─────────────────────────────────────────────────────────────────

const cw = await vault.challengeWindow();
console.log('\n══ SEED COMPLETE ══════════════════════════════════════════════');
console.log(`  Claim A  id=${claimIdA}  status="Funded - Repayment Due"`);
console.log(`  Claim B  id=${claimIdB}  status="Evidence Submitted - Challenge Window Open"`);
console.log(`  Claim 1  id=1            status="Disputed"  (already on-chain)`);
console.log(`  challengeWindow=${cw}s`);
console.log(`\n  Preview URL (paste in Playwright or browser):`);
console.log(`  http://localhost:5173/?preview_investor=${investor.address}`);
