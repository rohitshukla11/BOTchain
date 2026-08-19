import { useState, useEffect } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { isAddress } from 'viem';
import { CONTRACTS } from '../config/contracts.ts';
import VeriflowClaimNFTABI from '../config/abis/VeriflowClaimNFT.json';

// Minimal event ABI for getLogs
const ALLOWLIST_EVENT_ABI = [{
  anonymous: false,
  inputs: [
    { indexed: true,  name: 'originator', type: 'address' },
    { indexed: false, name: 'status',     type: 'bool'    },
  ],
  name: 'OriginatorAllowlisted',
  type: 'event',
}] as const;

const NFT_ADDRESS = CONTRACTS.VeriflowClaimNFT as `0x${string}`;

// ── Hook: fetch all OriginatorAllowlisted events and derive current list ──────
function useAllowlistedAddresses() {
  const client = usePublicClient();
  const [list, setList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetch() {
    if (!client) return;
    setLoading(true);
    try {
      const logs = await client.getLogs({
        address: NFT_ADDRESS,
        event: ALLOWLIST_EVENT_ABI[0],
        fromBlock: 0n,
        toBlock: 'latest',
      });
      // derive current state: keep only addresses whose last event had status=true
      const state = new Map<string, boolean>();
      for (const log of logs) {
        const addr = (log.args as { originator: string }).originator?.toLowerCase();
        const status = (log.args as { status: boolean }).status;
        if (addr) state.set(addr, status);
      }
      setList([...state.entries()].filter(([, v]) => v).map(([k]) => k));
    } catch (e) {
      console.error('getLogs error', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetch(); }, [client]);
  return { list, loading, refetch: fetch };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPanel() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CredFi | Admin Panel';

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const previousDescription = meta?.getAttribute('content') ?? '';

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', 'CredFi admin controls for managing originator allowlist permissions.');

    return () => {
      document.title = previousTitle;
      if (createdMeta) {
        meta?.remove();
      } else {
        meta?.setAttribute('content', previousDescription);
      }
    };
  }, []);

  const { address, isConnected } = useAccount();

  // Owner check
  const { data: owner } = useReadContract({
    address: NFT_ADDRESS,
    abi: VeriflowClaimNFTABI,
    functionName: 'owner',
    query: { enabled: isConnected },
  });

  const isOwner = !!address && !!owner &&
    address.toLowerCase() === (owner as string).toLowerCase();

  const { list, loading, refetch } = useAllowlistedAddresses();
  const [inputAddr, setInputAddr] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState('');

  const { writeContractAsync } = useWriteContract();
  const { isLoading: isTxPending, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // After tx confirms, clear and refresh list
  useEffect(() => {
    if (isTxSuccess) {
      setInputAddr('');
      setTxHash(null);
      refetch();
    }
  }, [isTxSuccess]);

  if (!isConnected) {
    return <div className="vf-connect-wall"><p>Connect your wallet to access the Admin Panel.</p></div>;
  }

  if (!isOwner) {
    return (
      <div className="vf-page">
        <h2>Admin Panel</h2>
        <div className="vf-alert vf-alert-error">
          Connected wallet is not the contract owner.<br />
          Owner: <code style={{ fontSize: '0.8rem' }}>{owner as string ?? '…'}</code>
        </div>
      </div>
    );
  }

  async function handleAllowlist(status: boolean) {
    setError('');
    setTxHash(null);
    if (!isAddress(inputAddr)) {
      setError('Invalid address.');
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: NFT_ADDRESS,
        abi: VeriflowClaimNFTABI,
        functionName: 'setAllowlisted',
        args: [inputAddr as `0x${string}`, status],
      });
      setTxHash(hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="vf-page">
      <h2>Admin Panel</h2>
      <p className="sub">Manage the CredFi originator allowlist. Only the contract owner can call these functions.</p>

      {/* ── Allowlist an address ─────────────────────────────── */}
      <div className="vf-card">
        <h3>Allowlist / Revoke Originator</h3>
        <div className="vf-field">
          <label>Originator Address</label>
          <input
            className="vf-input"
            placeholder="0x…"
            value={inputAddr}
            onChange={e => setInputAddr(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            className="vf-btn vf-btn-primary"
            disabled={!inputAddr || isTxPending}
            onClick={() => handleAllowlist(true)}
          >
            {isTxPending ? 'Waiting…' : '✓ Allowlist'}
          </button>
          <button
            className="vf-btn vf-btn-secondary"
            disabled={!inputAddr || isTxPending}
            onClick={() => handleAllowlist(false)}
          >
            {isTxPending ? 'Waiting…' : '✕ Revoke'}
          </button>
        </div>

        {error && <div className="vf-alert vf-alert-error">{error}</div>}

        {txHash && (
          <div className="vf-alert vf-alert-success">
            Tx submitted:{' '}
            <a className="vf-txlink" href={`https://scan.bohr.life/tx/${txHash}`} target="_blank" rel="noreferrer">
              {txHash.slice(0, 20)}…
            </a>
          </div>
        )}

        {isTxSuccess && (
          <div className="vf-alert vf-alert-success">✓ On-chain — list refreshed.</div>
        )}
      </div>

      {/* ── Current allowlist ────────────────────────────────── */}
      <div className="vf-card">
        <h3>Currently Allowlisted Originators</h3>
        {loading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text)' }}>Loading from chain events…</p>
        ) : list.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text)' }}>No allowlisted originators found.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {list.map(addr => (
              <li key={addr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <code style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--text-h)' }}>
                  {addr}
                </code>
                <span className="vf-badge vf-badge-green">active</span>
              </li>
            ))}
          </ul>
        )}
        <button
          className="vf-btn vf-btn-secondary"
          style={{ alignSelf: 'flex-start', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
          onClick={refetch}
        >
          Refresh
        </button>
      </div>

      {/* ── Contract info ─────────────────────────────────────── */}
      <div className="vf-card">
        <h3>Contract Info</h3>
        <div className="vf-stats">
          <div className="vf-stat">
            <span className="vf-stat-label">Owner</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-h)', fontFamily: 'var(--mono)' }}>{(owner as string)?.slice(0,10)}…</code>
          </div>
          <div className="vf-stat">
            <span className="vf-stat-label">NFT Contract</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-h)', fontFamily: 'var(--mono)' }}>{NFT_ADDRESS.slice(0,10)}…</code>
          </div>
          <div className="vf-stat">
            <span className="vf-stat-label">Allowlisted Count</span>
            <span className="vf-stat-value">{loading ? '…' : list.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
