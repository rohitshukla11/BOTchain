import { activeChain, botchainMainnet, botchainTestnet } from './chains.ts';

type AddressBook = {
  MockStablecoin: `0x${string}`;
  RiskOracle: `0x${string}`;
  ArbitratorMultisig: `0x${string}`;
  VeriflowClaimVault: `0x${string}`;
  VeriflowClaimNFT: `0x${string}`;
};

// BOT Chain Testnet (968) — deployed 2026-08-18 from a clean build.
// Allowlisted originators: deployer 0x0ed55CD8…, 0x150C659d…, 0x68343Aa0…
const TESTNET: AddressBook = {
  MockStablecoin: '0x2DC17aD3AF5E195c96d53c916F9e3c95FEea4bA2',
  RiskOracle: '0xA94B7Fd8ac55Fd481B559caC159309Bc779f34c0',
  ArbitratorMultisig: '0x829A3Da07b4f043789496d77F0C304DE7aFc67E4',
  VeriflowClaimVault: '0xAC0B43de7893Ec6CaBFd25940987779668F1204B',
  VeriflowClaimNFT: '0xc4e7dD84165a5247637E106f4Bbe9520876D05b3',
};

// BOT Chain Mainnet (677) — NOT YET DEPLOYED.
// Populate from deployments/677.json after running scripts/deploy.ts, then set
// `activeChain = botchainMainnet` in ./chains.ts.
const MAINNET: AddressBook | null = null;

const BY_CHAIN: Record<number, AddressBook | null> = {
  [botchainTestnet.id]: TESTNET,
  [botchainMainnet.id]: MAINNET,
};

const resolved = BY_CHAIN[activeChain.id];
if (!resolved) {
  throw new Error(
    `No contract addresses recorded for ${activeChain.name} (chainId ${activeChain.id}). ` +
      `Deploy with scripts/deploy.ts and fill in the address book in config/contracts.ts.`,
  );
}

export const CONTRACTS = resolved;

export type ContractName = keyof AddressBook;
