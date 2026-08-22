// Bytecode-marker verification for the final pre-deploy build.
//
// Two independent checks:
//   1. Build integrity — the artifact was compiled from exactly the .sol files
//      currently on disk (keccak of source text vs. the hash recorded in build-info).
//   2. Marker presence — each of today's five fixes leaves a distinctive 4-byte
//      selector or 32-byte event topic in the *runtime* bytecode. Absence of a
//      marker means the fix is not in the compiled artifact being deployed.

import { readFileSync, readdirSync } from 'node:fs';
import { keccak256, toUtf8Bytes, id } from 'ethers';

const sel = (sig) => id(sig).slice(0, 10);          // 4-byte selector, '0x'-prefixed
const topic = (sig) => id(sig);                      // 32-byte event topic

const artifact = (p) => JSON.parse(readFileSync(`artifacts/contracts/${p}`, 'utf8'));

const VAULT = artifact('VeriflowClaimVault.sol/VeriflowClaimVault.json');
const ORACLE = artifact('RiskOracle.sol/RiskOracle.json');
const MULTISIG = artifact('ArbitratorMultisig.sol/ArbitratorMultisig.json');

// ---------------------------------------------------------------- build integrity

const buildInfoDir = 'artifacts/build-info';
const buildInfos = readdirSync(buildInfoDir)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.output.json'))
  .map((f) => JSON.parse(readFileSync(`${buildInfoDir}/${f}`, 'utf8')));

const SOURCES = [
  'contracts/VeriflowClaimVault.sol',
  'contracts/RiskOracle.sol',
  'contracts/ArbitratorMultisig.sol',
  'contracts/VeriflowClaimNFT.sol',
  'contracts/test/MockStablecoin.sol',
];

console.log('=== 1. BUILD INTEGRITY (artifact compiled from on-disk sources) ===\n');
let integrityOk = true;
for (const src of SOURCES) {
  const onDisk = keccak256(toUtf8Bytes(readFileSync(src, 'utf8')));
  // Hardhat 3 remaps user source names ("contracts/X.sol") to internal names
  // ("project/contracts/X.sol") via userSourceNameMap.
  const bi = buildInfos.find((b) => b.input?.sources?.[b.userSourceNameMap?.[src] ?? src]);
  if (!bi) {
    console.log(`  ?? ${src.padEnd(38)} not present in any build-info`);
    integrityOk = false;
    continue;
  }
  const internalName = bi.userSourceNameMap?.[src] ?? src;
  const compiled = keccak256(toUtf8Bytes(bi.input.sources[internalName].content));
  const match = onDisk === compiled;
  if (!match) integrityOk = false;
  console.log(`  ${match ? 'OK' : 'XX'} ${src.padEnd(38)} ${onDisk.slice(0, 18)}…`);
}

// ---------------------------------------------------------------- markers

const MARKERS = [
  {
    fix: 'funding cap enforcement',
    contract: 'VeriflowClaimVault',
    bytecode: VAULT.deployedBytecode,
    needles: [
      ['error FundingAboveCap()', sel('FundingAboveCap()')],
      ['call  getRequiredCollateral(uint8,uint256)', sel('getRequiredCollateral(uint8,uint256)')],
    ],
  },
  {
    fix: 'fail-loud RiskOracle check',
    contract: 'VeriflowClaimVault',
    bytecode: VAULT.deployedBytecode,
    needles: [
      ['error RiskOracleNotSet()', sel('RiskOracleNotSet()')],
      ['setter riskOracle()', sel('riskOracle()')],
    ],
  },
  {
    fix: 'yield calculation',
    contract: 'VeriflowClaimVault',
    bytecode: VAULT.deployedBytecode,
    needles: [
      ['constant YIELD_BPS()', sel('YIELD_BPS()')],
      ['event RepaymentDeposited(uint256,uint256)', topic('RepaymentDeposited(uint256,uint256)')],
    ],
  },
  {
    fix: 'immediate payout',
    contract: 'VeriflowClaimVault',
    bytecode: VAULT.deployedBytecode,
    needles: [
      // fundClaim resolves the originator from the NFT in order to pay it directly
      ['call  claims(uint256)', sel('claims(uint256)')],
      ['event FundingDeposited(uint256,address,uint256)', topic('FundingDeposited(uint256,address,uint256)')],
    ],
  },
  {
    fix: 'claim-scoped dispute resolution',
    contract: 'VeriflowClaimVault',
    bytecode: VAULT.deployedBytecode,
    needles: [
      ['fn    raiseDispute(uint256,bytes32)', sel('raiseDispute(uint256,bytes32)')],
      ['event DisputeRaised(uint256,bytes32)', topic('DisputeRaised(uint256,bytes32)')],
    ],
  },
  {
    fix: 'claim-scoped dispute resolution',
    contract: 'ArbitratorMultisig',
    bytecode: MULTISIG.deployedBytecode,
    needles: [
      ['mapping claimResolutions(uint256)', sel('claimResolutions(uint256)')],
      ['event ClaimResolved(uint256,bool,address)', topic('ClaimResolved(uint256,bool,address)')],
    ],
  },
  {
    fix: 'risk tiers (oracle)',
    contract: 'RiskOracle',
    bytecode: ORACLE.deployedBytecode,
    needles: [
      ['fn    getRequiredCollateral(uint8,uint256)', sel('getRequiredCollateral(uint8,uint256)')],
      ['fn    collateralRatioBps(uint8)', sel('collateralRatioBps(uint8)')],
    ],
  },
];

console.log('\n=== 2. BYTECODE MARKERS (runtime bytecode of final build) ===\n');
let allFound = true;
for (const m of MARKERS) {
  const hay = m.bytecode.toLowerCase();
  console.log(`  [${m.contract}] ${m.fix}`);
  for (const [label, needle] of m.needles) {
    const found = hay.includes(needle.slice(2).toLowerCase());
    if (!found) allFound = false;
    console.log(`     ${found ? 'FOUND  ' : 'MISSING'} ${needle}  ${label}`);
  }
}

// ---------------------------------------------------------------- negative control

console.log('\n=== 3. NEGATIVE CONTROL (pre-fix escrow path must be absent) ===\n');
const NEGATIVE = [
  ['VeriflowClaimVault', VAULT.deployedBytecode, 'releaseFundingToOriginator(uint256)'],
  ['VeriflowClaimVault', VAULT.deployedBytecode, 'withdrawFunding(uint256)'],
];
let negativeOk = true;
for (const [name, bc, sig] of NEGATIVE) {
  const present = bc.toLowerCase().includes(sel(sig).slice(2).toLowerCase());
  if (present) negativeOk = false;
  console.log(`  ${present ? 'XX PRESENT' : 'OK absent '} ${sel(sig)}  ${name}.${sig}`);
}

console.log('\n=== RESULT ===');
console.log(`  build integrity : ${integrityOk ? 'PASS' : 'FAIL'}`);
console.log(`  markers present : ${allFound ? 'PASS' : 'FAIL'}`);
console.log(`  negative control: ${negativeOk ? 'PASS' : 'FAIL'}`);
process.exitCode = integrityOk && allFound && negativeOk ? 0 : 1;
