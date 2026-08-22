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

// BOT Chain Mainnet (677) — deployed 2026-08-22, see deployments/677.json.
// Allowlisted originators: deployer 0x68343Aa0…, 0x150C659d…
const MAINNET: AddressBook | null = {
  MockStablecoin: '0x680A55c0Db4B44def9d88cCBF450C1f5dd37fd9a',
  RiskOracle: '0x87934d5E1A61be3Bb06FE54AC7e21E7704731d1C',
  ArbitratorMultisig: '0xE33Dc788C060cb77F79A2AFF96Ca685f6C018721',
  VeriflowClaimVault: '0x38703a57c5f8eB2F8d1576A3d2B4B35A10D66FA6',
  VeriflowClaimNFT: '0x8a747D78811066F58A0dDe04E82165A02fA37725',
};

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
