import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useConfig } from 'wagmi';

const TARGET_CHAIN = 968; // BOT Chain Testnet

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const config = useConfig();
  const { connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const onWrongChain = isConnected && chainId !== TARGET_CHAIN;

  if (isConnected && address) {
    return (
      <div className="vf-wallet-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {onWrongChain ? (
          <button
            className="vf-btn vf-btn-primary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.82rem', background: '#f5b65c', color: '#0b0d10', boxShadow: 'none' }}
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: TARGET_CHAIN })}
          >
            {isSwitching ? 'Switching…' : '⚠ Switch to BOT Chain Testnet'}
          </button>
        ) : (
          <span className="vf-wallet-pill" style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--text)' }}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        )}
        <button
          className="vf-btn vf-btn-secondary"
          style={{ padding: '0.45rem 0.95rem', fontSize: '0.8rem' }}
          onClick={() => disconnect()}
        >
          Disconnect
        </button>
      </div>
    );
  }

  const injectedConnector = config.connectors.find(c => c.type === 'injected');
  const noProvider = typeof window !== 'undefined' && !(window as Record<string, unknown>).ethereum;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
      <button
        className="vf-btn vf-btn-primary"
        style={{ padding: '0.5rem 1.05rem', fontSize: '0.82rem' }}
        disabled={isConnecting || !injectedConnector}
        onClick={() => {
          if (injectedConnector) connect({ connector: injectedConnector });
        }}
      >
        {isConnecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {noProvider && (
        <span style={{ fontSize: '0.72rem', color: 'var(--warning)' }}>
          MetaMask not detected — install it first
        </span>
      )}
      {connectError && (
        <span style={{ fontSize: '0.72rem', color: 'var(--danger)', maxWidth: '220px', textAlign: 'right' }}>
          {connectError.message}
        </span>
      )}
    </div>
  );
}
