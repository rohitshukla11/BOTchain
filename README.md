# CredFi — BOT Chain Builder Challenge #2 (RWA Track)

## Project Structure

```
BOTchain/
├── contracts/          # Solidity smart contracts
├── scripts/            # Deployment & utility scripts
├── test/               # Hardhat tests (TypeScript)
├── frontend/           # React + TypeScript dApp (scaffolded separately)
├── hardhat.config.ts
├── tsconfig.json
└── .env.example
```

## Chain Configuration

| Network            | Chain ID | RPC                      | Explorer                   |
|--------------------|----------|--------------------------|----------------------------|
| BOT Chain Mainnet  | 677      | https://rpc.botchain.ai  | https://scan.botchain.ai   |
| BOT Chain Testnet  | 968      | https://rpc.bohr.life    | https://scan.bohr.life     |

Source: https://dev-docs.botchain.ai/docs/Developers/quick-guide/

## Getting Started

```bash
cp .env.example .env
# fill in PRIVATE_KEY and RPC_URL

npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network botchain_testnet
```
