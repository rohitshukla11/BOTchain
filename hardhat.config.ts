import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

// Per-network RPC overrides. Deliberately NOT a shared `RPC_URL`: a single
// variable pointed one network's URL at the other's chainId and every request
// failed the chain-ID check.
const BOTCHAIN_MAINNET_RPC = process.env.BOTCHAIN_MAINNET_RPC_URL ?? "https://rpc.botchain.ai";
const BOTCHAIN_TESTNET_RPC = process.env.BOTCHAIN_TESTNET_RPC_URL ?? "https://rpc.bohr.life";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x1111111111111111111111111111111111111111111111111111111111111111";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: {
      mocha: "./test",
    },
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
    },
    botchain: {
      type: "http",
      chainType: "l1",
      chainId: 677,
      url: BOTCHAIN_MAINNET_RPC,
      accounts: [PRIVATE_KEY],
    },
    botchain_testnet: {
      type: "http",
      chainType: "l1",
      chainId: 968,
      url: BOTCHAIN_TESTNET_RPC,
      accounts: [PRIVATE_KEY],
    },
  },
  chainDescriptors: {
    677: {
      name: "BOT Chain Mainnet",
      blockExplorers: {
        etherscan: {
          name: "BOTScan",
          url: "https://scan.botchain.ai",
          apiUrl: "https://scan.botchain.ai/api",
        },
        blockscout: {
          name: "BOTScan",
          url: "https://scan.botchain.ai",
          apiUrl: "https://scan.botchain.ai/api",
        },
      },
    },
    968: {
      name: "BOT Chain Testnet",
      blockExplorers: {
        etherscan: {
          name: "BOTScan Testnet",
          url: "https://scan.bohr.life",
          apiUrl: "https://scan.bohr.life/api",
        },
        blockscout: {
          name: "BOTScan Testnet",
          url: "https://scan.bohr.life",
          apiUrl: "https://scan.bohr.life/api",
        },
      },
    },
  },
});
