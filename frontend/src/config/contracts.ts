// Addresses from clean-build deploy — 2026-08-18
// Compiled from: rm -rf artifacts cache && npx hardhat compile (build 18:03 UTC)
// Bytecode verified: logic-equivalent after masking immutable slots.
// Deployer and 0x68343Aa0598b7FCAA102769D172e59cdDfae10f2 are allowlisted.

export const CONTRACTS = {
  MockStablecoin:    '0x2DC17aD3AF5E195c96d53c916F9e3c95FEea4bA2',
  RiskOracle:        '0xA94B7Fd8ac55Fd481B559caC159309Bc779f34c0',
  ArbitratorMultisig:'0x829A3Da07b4f043789496d77F0C304DE7aFc67E4',
  VeriflowClaimVault:'0xAC0B43de7893Ec6CaBFd25940987779668F1204B',
  VeriflowClaimNFT:  '0xc4e7dD84165a5247637E106f4Bbe9520876D05b3',
} as const;

export type ContractName = keyof typeof CONTRACTS;


