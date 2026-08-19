import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { botchainTestnet } from './chains.ts';

export const wagmiConfig = createConfig({
  chains: [botchainTestnet],
  connectors: [injected()],
  transports: {
    [botchainTestnet.id]: http('https://rpc.bohr.life'),
  },
});
