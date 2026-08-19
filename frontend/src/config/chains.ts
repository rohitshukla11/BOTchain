import { defineChain } from 'viem';

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
