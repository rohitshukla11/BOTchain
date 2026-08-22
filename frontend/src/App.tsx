import { useState } from 'react';
import { useAccount, useReadContract, useChainId, useSwitchChain } from 'wagmi';
import './veriflow.css';
import { ConnectWallet } from './components/ConnectWallet.tsx';
import ListClaim from './pages/ListClaim.tsx';
import BrowseFund from './pages/BrowseFund.tsx';
import MyClaims from './pages/MyClaims.tsx';
import MyPositions from './pages/MyPositions.tsx';
import ArbitratorPanel from './pages/ArbitratorPanel.tsx';
import AdminPanel from './pages/AdminPanel.tsx';
import LandingPage from './pages/LandingPage.tsx';
import { CONTRACTS } from './config/contracts.ts';
import VeriflowClaimNFTABI from './config/abis/VeriflowClaimNFT.json';

const BOT_CHAIN_ID = 968;

const TABS = [
  { id: 'list',      label: 'List a Claim' },
  { id: 'browse',    label: 'Browse & Fund' },
  { id: 'myclaims',  label: 'My Claims' },
  { id: 'positions', label: 'My Positions' },
  { id: 'arb',       label: 'Arbitrator Panel' },
] as const;

type TabId = typeof TABS[number]['id'];



export default function App() {
  const [view, setView] = useState<'landing' | 'app'>('landing');
  const [activeTab, setActiveTab] = useState<TabId>('list');
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onWrongChain = isConnected && chainId !== BOT_CHAIN_ID;

  const { data: owner } = useReadContract({
    address: CONTRACTS.VeriflowClaimNFT as `0x${string}`,
    abi: VeriflowClaimNFTABI,
    functionName: 'owner',
    query: { enabled: isConnected },
  });

  const isOwner = !!address && !!owner &&
    address.toLowerCase() === (owner as string).toLowerCase();

  return (
    <div className="vf-shell">
      <header className={`vf-header${view === 'landing' ? ' vf-header-landing' : ''}`}>
        <div className="vf-brand">
          <span className="vf-logo-mark" aria-hidden="true" />
          <span className="vf-logo">Cred<span>Fi</span></span>
        </div>

        {view === 'app' ? (
          <nav className="vf-tabs" aria-label="Primary navigation tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`vf-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {isOwner && (
              <button
                className={`vf-tab${activeTab === ('admin' as string) ? ' active' : ''}`}
                onClick={() => setActiveTab('admin' as TabId)}
              >
                Admin
              </button>
            )}
          </nav>
        ) : null}

        {view === 'app' ? <ConnectWallet /> : (
          <button className="vf-btn vf-btn-primary" onClick={() => setView('app')}>Launch app</button>
        )}
      </header>

      {view === 'app' && onWrongChain && (
        <div style={{ background: '#f59e0b22', borderBottom: '1px solid #f59e0b55', padding: '0.65rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: '#f59e0b' }}>
          <span>⚠ MetaMask is connected to the wrong network. Switch to BOT Chain Testnet (chainId 968) to use CredFi.</span>
          <button className="vf-btn" style={{ background: '#f59e0b', color: '#000', padding: '0.35rem 0.9rem', fontSize: '0.8rem', fontWeight: 700 }} disabled={isSwitching} onClick={() => switchChain({ chainId: BOT_CHAIN_ID })}>
            {isSwitching ? 'Switching…' : 'Switch Now'}
          </button>
        </div>
      )}

      {view === 'landing' ? (
        <LandingPage onLaunch={() => setView('app')} />
      ) : (
        <>
          {activeTab === 'list'      && <ListClaim />}
          {activeTab === 'browse'    && <BrowseFund />}
          {activeTab === 'myclaims'  && <MyClaims />}
          {activeTab === 'positions' && <MyPositions />}
          {activeTab === 'arb'       && <ArbitratorPanel />}
          {activeTab === ('admin' as TabId) && <AdminPanel />}
        </>
      )}
    </div>
  );
}
