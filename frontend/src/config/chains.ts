import { defineChain } from 'viem';

export const botchainMainnet = defineChain({
  id: 677,
  name: 'BOT Chain Mainnet',
  nativeCurrency: {
    decimals: 18,
    name: 'BOT',
    symbol: 'BOT',
  },
  rpcUrls: {
    default: { http: ['https://rpc.botchain.ai'] },
  },
  blockExplorers: {
    default: {
      name: 'BOTScan',
      url: 'https://scan.botchain.ai',
    },
  },
  testnet: false,
});

export const botchainTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'BOT',
    symbol: 'BOT',
  },
  rpcUrls: {
    default: { http: ['https://rpc.bohr.life'] },
  },
  blockExplorers: {
    default: {
      name: 'BOTScan Testnet',
      url: 'https://scan.bohr.life',
    },
  },
  testnet: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Single switch point for the whole frontend. Flip to `botchainMainnet` once
// the mainnet addresses in ./contracts.ts are populated — contracts.ts throws
// at import time if the active chain has no deployment recorded, so the two
// can never drift apart silently.
// ─────────────────────────────────────────────────────────────────────────────
export const activeChain = botchainTestnet;
