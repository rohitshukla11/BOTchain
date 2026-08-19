import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { botchainTestnet } from '../config/chains.ts';

const TARGET_CHAIN = botchainTestnet.id; // 968

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const onWrongChain = isConnected && chainId !== TARGET_CHAIN;

  if (isConnected && address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {onWrongChain ? (
          <button
            className="vf-btn vf-btn-primary"
            style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: '#f59e0b' }}
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: TARGET_CHAIN })}
          >
            {isSwitching ? 'Switching…' : '⚠ Switch to BOT Chain Testnet'}
          </button>
        ) : (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--text)' }}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        )}
        <button
          className="vf-btn vf-btn-secondary"
          style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem' }}
          onClick={() => disconnect()}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      className="vf-btn vf-btn-primary"
      style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
      disabled={isConnecting}
      onClick={() => connect({ connector: injected() })}
    >
      {isConnecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}
